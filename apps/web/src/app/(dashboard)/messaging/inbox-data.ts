
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  chats,
  companyRecords,
  handoffRequests,
  messages,
  type CompanyRecordStatus,
  type HandoffRequestStatus,
  type MessageMetadata,
} from "@/db/schema";
import {
  buildTimeline,
  composerMode,
  conversationChip,
  CUSTOMER_CHANNELS,
  formatClock,
  formatDuration,
  formatListTime,
  formatStarted,
  handoffEvents,
  handoffNarrative,
  handoffRowChip,
  humanizeTool,
  isWaitingForYou,
  questionFooter,
  SOURCE_LABEL,
  toInboxSource,
  type Chip,
  type ComposerMode,
  type HandoffEvent,
  type InboxConversation,
  type InboxHandoff,
  type InboxSource,
} from "@/components/messaging/inbox-model";
import type { IconName } from "@/components/v2/primitives/icon";

/** Transcript row, preformatted for the client pane. */
export type InboxTranscriptItem =
  | {
      kind: "message";
      id: string;
      /** customer | agent | person (a human message through handoff or the Inbox). */
      from: "customer" | "agent" | "person";
      author: string;
      time: string;
      text: string;
      /** Tool calls the agent made before this reply ("Knowledge base search"). */
      tools: string[];
    }
  | { kind: "event"; id: string; icon: IconName; tone: HandoffEvent["tone"]; text: string };

export type InboxHandoffCard = {
  status: HandoffRequestStatus;
  chip: Chip;
  /** Header chip: "Handed to Markus Albrecht" or "Back to agent". */
  headerLabel: string;
  question: string | null;
  alsoAsked: string[];
  reason: string | null;
  footer: { icon: IconName; text: string };
  narrative: string;
  /** Figma takeover-auto-ended: Take over again on a handed-back request. */
  canTakeOverAgain: boolean;
};

export type InboxLeadCard = {
  name: string;
  chip: Chip;
  note: string;
  score: number | null;
  line: string | null;
};

export type InboxDetail = {
  id: string;
  customer: string;
  customerMeta: string;
  source: InboxSource;
  agentId: string | null;
  agentName: string | null;
  chip: Chip;
  handoff: InboxHandoffCard | null;
  composer: ComposerMode | null;
  transcript: InboxTranscriptItem[];
  details: { customer: string; source: string; agent: string | null; started: string; duration: string };
  lead: InboxLeadCard | null;
};

export type InboxData = {
  conversations: InboxConversation[];
  selected: InboxDetail | null;
  /** True when no chatId was asked for and the first row was picked. */
  autoSelected: boolean;
};

type ChatRow = {
  id: string;
  title: string | null;
  visitorId: string | null;
  channelType: string | null;
  agentId: string | null;
  createdAt: Date;
  agentName: string | null;
  lastMessage: { content: string; createdAt: Date } | null;
};

const TRANSCRIPT_LIMIT = 300;

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

function customerName(chat: Pick<ChatRow, "title" | "visitorId">, senderName: string | undefined): string {
  const name = senderName?.trim() || chat.title?.trim();
  if (name) return name;
  return chat.visitorId ? `Visitor ${chat.visitorId.slice(-4)}` : "Visitor";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function agentLineFor(latest: InboxHandoff | null, agentName: string | null): string {
  if (!latest) return agentName ?? "Customer agent";
  if (latest.status === "handed_back") return "Back to agent after Takeover";
  if (latest.mode === "team_chat") return "Handed to the team chat";
  return latest.recipientName ? `Handed to ${latest.recipientName}` : "Handed to the Inbox";
}

/** Latest sender name per chat, from inbound message metadata (WhatsApp/Instagram profile). */
async function senderNames(chatIds: string[]): Promise<Map<string, string>> {
  if (chatIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([messages.chatId], {
      chatId: messages.chatId,
      senderName: sql<string | null>`${messages.metadata} ->> 'senderName'`,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.chatId, chatIds),
        eq(messages.role, "user"),
        sql`${messages.metadata} ->> 'senderName' is not null`,
      ),
    )
    .orderBy(messages.chatId, desc(messages.createdAt));
  return new Map(
    rows.flatMap((row) => (row.senderName ? [[row.chatId, row.senderName] as const] : [])),
  );
}

async function lastHumanMessages(chatIds: string[]): Promise<Map<string, Date>> {
  if (chatIds.length === 0) return new Map();
  const rows = await db
    .select({
      chatId: messages.chatId,
      at: sql<Date>`max(${messages.createdAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(messages)
    .where(and(inArray(messages.chatId, chatIds), eq(messages.author, "human")))
    .groupBy(messages.chatId);
  return new Map(rows.map((row) => [row.chatId, row.at]));
}

async function handoffsByChat(
  companyId: string,
  chatIds: string[],
): Promise<Map<string, InboxHandoff[]>> {
  if (chatIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(handoffRequests)
    .where(and(eq(handoffRequests.companyId, companyId), inArray(handoffRequests.chatId, chatIds)))
    .orderBy(asc(handoffRequests.createdAt));
  const byChat = new Map<string, InboxHandoff[]>();
  for (const row of rows) {
    const list = byChat.get(row.chatId) ?? [];
    list.push(toHandoff(row));
    byChat.set(row.chatId, list);
  }
  return byChat;
}

const LEAD_CHIP: Partial<Record<CompanyRecordStatus, Chip>> = {
  gathered: { tone: "neutral", label: "Gathered" },
  qualified: { tone: "success", label: "Qualified" },
  borderline: { tone: "pending", label: "Borderline" },
  rejected: { tone: "error", label: "Rejected" },
  unqualified: { tone: "error", label: "Unqualified" },
  delivered: { tone: "success", label: "Delivered" },
  interested: { tone: "success", label: "Interested" },
  meeting: { tone: "success", label: "Meeting" },
  proposal: { tone: "success", label: "Proposal" },
  won: { tone: "success", label: "Won" },
};

function leadChip(status: CompanyRecordStatus): Chip {
  return LEAD_CHIP[status] ?? { tone: "neutral", label: status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) };
}

export async function loadInbox(input: {
  companyId: string;
  companyName: string;
  timeZone: string;
  chatId: string | null;
  now?: Date;
}): Promise<InboxData> {
  const now = input.now ?? new Date();
  const tz = input.timeZone;

  const chatRows = await db.query.chats.findMany({
    where: and(eq(chats.companyId, input.companyId), inArray(chats.channelType, [...CUSTOMER_CHANNELS])),
    with: {
      messages: { limit: 1, orderBy: desc(messages.createdAt) },
      agent: true,
    },
    orderBy: desc(chats.createdAt),
  });

  const rows: ChatRow[] = chatRows.map((chat) => ({
    id: chat.id,
    title: chat.title,
    visitorId: chat.visitorId,
    channelType: chat.channelType,
    agentId: chat.agentId,
    createdAt: chat.createdAt,
    agentName: chat.agent?.name ?? null,
    lastMessage: chat.messages[0]
      ? { content: chat.messages[0].content, createdAt: chat.messages[0].createdAt }
      : null,
  }));
  rows.sort(
    (a, b) =>
      (b.lastMessage?.createdAt ?? b.createdAt).getTime() -
      (a.lastMessage?.createdAt ?? a.createdAt).getTime(),
  );

  const chatIds = rows.map((row) => row.id);
  const [names, lastHuman, handoffs] = await Promise.all([
    senderNames(chatIds),
    lastHumanMessages(chatIds),
    handoffsByChat(input.companyId, chatIds),
  ]);

  const conversations: InboxConversation[] = rows.map((row) => {
    const requests = handoffs.get(row.id) ?? [];
    const latest = requests.at(-1) ?? null;
    const lastAt = row.lastMessage?.createdAt ?? row.createdAt;
    const waiting = isWaitingForYou(latest, lastHuman.get(row.id) ?? null);
    return {
      id: row.id,
      customer: customerName(row, names.get(row.id)),
      source: toInboxSource(row.channelType),
      agentLine: agentLineFor(latest, row.agentName),
      handoff: latest !== null,
      time: formatListTime(lastAt, now, tz),
      snippet: row.lastMessage ? oneLine(row.lastMessage.content) : "No messages yet",
      chip: latest ? handoffRowChip(latest.status) : conversationChip(lastAt, now),
      waiting,
      escalated: latest !== null,
    };
  });

  const requestedId = input.chatId && rows.some((row) => row.id === input.chatId) ? input.chatId : null;
  const selectedId = requestedId ?? rows[0]?.id ?? null;
  if (!selectedId) return { conversations, selected: null, autoSelected: false };

  const row = rows.find((r) => r.id === selectedId)!;
  const listItem = conversations.find((c) => c.id === selectedId)!;
  const requests = handoffs.get(selectedId) ?? [];
  const selected = await loadDetail({
    row,
    listItem,
    requests,
    companyId: input.companyId,
    companyName: input.companyName,
    timeZone: tz,
  });
  return { conversations, selected, autoSelected: requestedId === null };
}

async function loadDetail(input: {
  row: ChatRow;
  listItem: InboxConversation;
  requests: InboxHandoff[];
  companyId: string;
  companyName: string;
  timeZone: string;
}): Promise<InboxDetail> {
  const { row, listItem, requests, timeZone: tz } = input;

  const [recent, lead, firstMessage] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, row.id), inArray(messages.role, ["user", "assistant"])))
      .orderBy(desc(messages.createdAt))
      .limit(TRANSCRIPT_LIMIT),
    db.query.companyRecords.findFirst({
      where: and(eq(companyRecords.chatId, row.id), eq(companyRecords.companyId, input.companyId)),
    }),
    db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.chatId, row.id))
      .orderBy(asc(messages.createdAt))
      .limit(1),
  ]);
  const ordered = recent.reverse();

  const agentName = row.agentName ?? "Customer agent";
  const messageItems = ordered
    .filter((m) => m.content.trim().length > 0)
    .map((m) => {
      const meta = (m.metadata ?? null) as MessageMetadata | null;
      const from: "customer" | "agent" | "person" =
        m.role === "user" ? "customer" : m.author === "human" ? "person" : "agent";
      const author =
        from === "customer"
          ? listItem.customer
          : from === "person"
            ? `${m.authorDisplayName ?? "Team"} · ${input.companyName}`
            : agentName;
      return {
        kind: "message" as const,
        at: m.createdAt,
        id: m.id,
        from,
        author,
        time: formatClock(m.createdAt, tz),
        text: m.content,
        tools: from === "agent" ? (meta?.toolCalls ?? []).map((call) => humanizeTool(call.tool)) : [],
      };
    });
  const events = requests.flatMap((request) => handoffEvents(request, tz));
  const transcript: InboxTranscriptItem[] = buildTimeline(messageItems, events).map((item) => {
    if (item.kind === "event") {
      return { kind: "event", id: item.id, icon: item.icon, tone: item.tone, text: item.text };
    }
    const { at: _at, ...rest } = item;
    void _at;
    return rest;
  });

  const latest = requests.at(-1) ?? null;
  const asked = [...requests].reverse().find((r) => r.questions.length > 0) ?? null;
  const handoff: InboxHandoffCard | null = latest
    ? {
        status: latest.status,
        chip: handoffRowChip(latest.status),
        headerLabel:
          latest.status === "handed_back"
            ? "Back to agent"
            : latest.mode === "team_chat"
              ? "Handed to the team chat"
              : `Handed to ${latest.recipientName ?? "the Inbox"}`,
        question: asked?.questions[0]?.text ?? null,
        alsoAsked: asked ? asked.questions.slice(1).map((q) => q.text) : [],
        reason: (asked ?? latest).reason || null,
        footer: questionFooter(latest, tz),
        narrative: handoffNarrative(latest, {
          customer: listItem.customer,
          company: input.companyName,
          timeZone: tz,
        }),
        canTakeOverAgain: latest.status === "handed_back",
      }
    : null;

  const startedAt = firstMessage[0]?.createdAt ?? row.createdAt;
  const lastAt = ordered.at(-1)?.createdAt ?? startedAt;
  const sourceLabel = SOURCE_LABEL[listItem.source];

  return {
    id: row.id,
    customer: listItem.customer,
    customerMeta: [agentName, sourceLabel, ordered[0] ? formatClock(ordered[0].createdAt, tz) : null]
      .filter(Boolean)
      .join(" · "),
    source: listItem.source,
    agentId: row.agentId,
    agentName: row.agentName,
    chip: latest ? (latest.status === "handed_back" ? { tone: "neutral", label: "Agent" } : handoffRowChip(latest.status)) : listItem.chip,
    handoff,
    composer: composerMode(latest?.status ?? null, listItem.waiting),
    transcript,
    details: {
      customer: listItem.customer,
      source: sourceLabel,
      agent: row.agentName,
      started: formatStarted(startedAt, tz),
      duration: formatDuration(lastAt.getTime() - startedAt.getTime()),
    },
    lead: lead
      ? {
          name: lead.name,
          chip: leadChip(lead.status),
          note: [
            `Captured from this conversation on ${formatStarted(lead.createdAt, tz)}.`,
            lead.score === null ? "Not scored yet." : `Fit score ${lead.score} of 100.`,
          ].join(" "),
          score: lead.score,
          line:
            lead.fitReasons.length > 0
              ? lead.fitReasons.join(" · ")
              : (lead.rejectReason ?? lead.domain ?? null),
        }
      : null,
  };
}
