import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { agents, chats, companyRecords, handoffRequests, messages, portalEvents } from "@/db/schema";
import { CUSTOMER_CHANNELS, toInboxSource, type InboxHandoff } from "@/components/messaging/inbox-model";
import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { FEED_DEFAULT_LIMIT, portalEventsReader } from "@/lib/live/feed";
import { getLiveSummary, type LiveSummary } from "@/lib/live/summary";
import { requireClientAccess, type CompanyAccessRole } from "@/lib/operator/access";

import { buildConversationView, type ConversationView } from "./conversation-model";
import { toFeedEvent, type FeedEvent, type LiveSearch } from "./live-model";

const TRANSCRIPT_LIMIT = 300;

export type WaitingOldest = { chatId: string; customer: string; since: Date };

export type LivePageData =
  | { kind: "no-company" }
  | { kind: "not-found" }
  | {
      kind: "live";
      company: { id: string; name: string };
      role: CompanyAccessRole;
      /** Owner / member preview: Answer now is replaced by Open in Inbox. */
      readOnly: boolean;
      summary: LiveSummary;
      events: FeedEvent[];
      waitingOldest: WaitingOldest | null;
      conversation: ConversationView | null;
      now: Date;
    };

type ChatRow = {
  id: string;
  title: string | null;
  visitorId: string | null;
  channelType: string | null;
  agentId: string | null;
  createdAt: Date;
};

const CUSTOMER = [...CUSTOMER_CHANNELS];

/** Customer-agent chat of this company, or null. */
async function findChat(companyId: string, chatId: string): Promise<ChatRow | null> {
  const row = await db.query.chats.findFirst({
    columns: { id: true, title: true, visitorId: true, channelType: true, agentId: true, createdAt: true },
    where: and(eq(chats.id, chatId), eq(chats.companyId, companyId), inArray(chats.channelType, CUSTOMER)),
  });
  return row ?? null;
}

async function senderName(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: sql<string | null>`${messages.metadata} ->> 'senderName'` })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(messages.role, "user"),
        sql`${messages.metadata} ->> 'senderName' is not null`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.name?.trim() || null;
}

async function customerOf(chat: Pick<ChatRow, "id" | "title" | "visitorId">): Promise<string> {
  const name = (await senderName(chat.id)) ?? chat.title?.trim();
  if (name) return name;
  return chat.visitorId ? `Visitor ${chat.visitorId.slice(-4)}` : "Visitor";
}

/** The chat a feed row points at: handoff request, lead record, or the chat itself. */
export async function resolveEventChatId(companyId: string, eventId: string): Promise<string | null> {
  const [event] = await db
    .select({ type: portalEvents.type, refId: portalEvents.refId })
    .from(portalEvents)
    .where(and(eq(portalEvents.id, eventId), eq(portalEvents.companyId, companyId)))
    .limit(1);
  if (!event?.refId) return null;
  switch (event.type) {
    case "handoff_sent": {
      const [row] = await db
        .select({ chatId: handoffRequests.chatId })
        .from(handoffRequests)
        .where(and(eq(handoffRequests.id, event.refId), eq(handoffRequests.companyId, companyId)))
        .limit(1);
      return row?.chatId ?? null;
    }
    case "lead_inbound_qualified":
    case "lead_delivered": {
      const [row] = await db
        .select({ chatId: companyRecords.chatId })
        .from(companyRecords)
        .where(and(eq(companyRecords.id, event.refId), eq(companyRecords.companyId, companyId)))
        .limit(1);
      return row?.chatId ?? null;
    }
    case "conversation_started":
      return event.refId;
    default:
      return null;
  }
}

/** Longest-waiting open handoff request, for the Waiting for staff card. */
async function oldestWaiting(companyId: string): Promise<WaitingOldest | null> {
  const [row] = await db
    .select({ chatId: handoffRequests.chatId, since: handoffRequests.createdAt })
    .from(handoffRequests)
    .where(and(eq(handoffRequests.companyId, companyId), eq(handoffRequests.status, "open")))
    .orderBy(asc(handoffRequests.createdAt))
    .limit(1);
  if (!row) return null;
  const chat = await findChat(companyId, row.chatId);
  if (!chat) return null;
  return { chatId: chat.id, customer: await customerOf(chat), since: row.since };
}

function toHandoff(row: typeof handoffRequests.$inferSelect): InboxHandoff {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    reason: row.reason,
    questions: row.questions ?? [],
    recipientName: row.recipientName,
    recipientWhatsapp: row.recipientWhatsapp,
    createdAt: row.createdAt,
    notifiedAt: row.notifiedAt,
    expiresAt: row.expiresAt,
    answeredAt: row.answeredAt,
    takenOverAt: row.takenOverAt,
    expiredAt: row.expiredAt,
    handedBackAt: row.handedBackAt,
    handBackReason: row.handBackReason,
  };
}

async function loadConversation(input: {
  companyId: string;
  companyName: string;
  chatId: string;
  timeZone: string;
  readOnly: boolean;
  now: Date;
}): Promise<ConversationView | null> {
  const chat = await findChat(input.companyId, input.chatId);
  if (!chat) return null;

  const [customer, agent, recent, requests] = await Promise.all([
    customerOf(chat),
    chat.agentId
      ? db.query.agents.findFirst({ columns: { name: true }, where: eq(agents.id, chat.agentId) })
      : Promise.resolve(undefined),
    db
      .select({
        id: messages.id,
        role: messages.role,
        author: messages.author,
        authorDisplayName: messages.authorDisplayName,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.chatId, chat.id), inArray(messages.role, ["user", "assistant"])))
      .orderBy(desc(messages.createdAt))
      .limit(TRANSCRIPT_LIMIT),
    db
      .select()
      .from(handoffRequests)
      .where(and(eq(handoffRequests.chatId, chat.id), eq(handoffRequests.companyId, input.companyId)))
      .orderBy(asc(handoffRequests.createdAt)),
  ]);

  return buildConversationView({
    chatId: chat.id,
    customer,
    source: toInboxSource(chat.channelType),
    agentName: agent?.name ?? null,
    companyName: input.companyName,
    messages: recent
      .reverse()
      .map((m) => ({ ...m, role: m.role === "user" ? ("user" as const) : ("assistant" as const) })),
    requests: requests.map(toHandoff),
    chatCreatedAt: chat.createdAt,
    timeZone: input.timeZone,
    now: input.now,
    readOnly: input.readOnly,
  });
}

/** Session → portal company → `requireClientAccess` → S90 summary + feed → optional sheet. */
export async function loadLivePage(search: LiveSearch, now: Date = new Date()): Promise<LivePageData> {
  const session = await requireSession();
  const companyId = await resolvePortalCompanyId(session.user.id);
  if (!companyId) return { kind: "no-company" };

  const { company, role } = await requireClientAccess(companyId);
  const [summary, events, waitingOldest] = await Promise.all([
    getLiveSummary(company.id, now),
    portalEventsReader.listPortalEvents(company.id, { limit: FEED_DEFAULT_LIMIT }),
    oldestWaiting(company.id),
  ]);
  if (!summary) return { kind: "not-found" };

  const readOnly = role !== "client";
  const chatId = search.chat ?? (search.event ? await resolveEventChatId(company.id, search.event) : null);
  const conversation = chatId
    ? await loadConversation({
        companyId: company.id,
        companyName: company.name,
        chatId,
        timeZone: summary.timeZone,
        readOnly,
        now,
      })
    : null;

  return {
    kind: "live",
    company: { id: company.id, name: company.name },
    role,
    readOnly,
    summary,
    events: events.map(toFeedEvent),
    waitingOldest,
    conversation,
    now,
  };
}
