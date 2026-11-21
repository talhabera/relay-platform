import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  chats,
  companies,
  handoffRequests,
  messages,
  type HandoffRequestStatus,
  type MessageMetadata,
} from "@/db/schema";

// Human handoff delivery to the widget (S34, handoff spec follow-up): a person's
// message is stored, never streamed by a chat turn, so the widget learns of it
// through an event stream while its panel is open and a fetch of missed
// messages when it reopens.

export const WIDGET_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
} as const;

export function widgetJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...WIDGET_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Worker metadata keys of assistant rows written outside a widget chat turn
 * (packages/worker handoff/follow-up.ts and handoff/sweep.ts).
 */
const OUT_OF_BAND_METADATA_KEYS = ["handoffRequestId", "handoffExpiredRequestId"] as const;

/** Most messages one fetch returns; the widget asks again from the last id. */
export const WIDGET_MESSAGES_PAGE = 100;

type MessageRow = Pick<
  typeof messages.$inferSelect,
  "id" | "chatId" | "role" | "content" | "author" | "authorDisplayName" | "metadata" | "createdAt"
>;

export type WidgetMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** `human` renders with the person marker ("Markus Albrecht · Acme GmbH"). */
  author: "agent" | "human" | null;
  authorDisplayName: string | null;
  createdAt: string;
};

export function toWidgetMessage(row: MessageRow): WidgetMessage {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    author: row.role === "user" ? null : (row.author ?? "agent"),
    authorDisplayName: row.author === "human" ? row.authorDisplayName : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A message the widget's own chat stream never carried: a person's message, the
 * agent's follow-up after a colleague answered, or the expiry notice.
 */
export function isOutOfBand(row: Pick<MessageRow, "role" | "author" | "metadata">): boolean {
  if (row.role !== "assistant") return false;
  if (row.author === "human") return true;
  const metadata = (row.metadata ?? {}) as MessageMetadata & Record<string, unknown>;
  return OUT_OF_BAND_METADATA_KEYS.some((key) => typeof metadata[key] === "string");
}

export type WidgetChatAccess =
  | { ok: true; companyId: string; chatId: string }
  | { ok: false; response: Response };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * The same ownership rule the chat turn uses (worker handle-internal-chat):
 * the chat is this company's widget chat, opened by this visitor.
 */
export async function resolveWidgetChat(
  widgetId: string,
  chatId: string | null,
  visitorId: string,
): Promise<WidgetChatAccess> {
  if (!isUuid(chatId)) {
    return { ok: false, response: widgetJson({ error: "chatId is required" }, 400) };
  }
  const company = await db.query.companies.findFirst({
    where: eq(companies.widgetId, widgetId),
  });
  if (!company) {
    return { ok: false, response: widgetJson({ error: "Widget not found" }, 404) };
  }
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.companyId, company.id)),
  });
  const own =
    !!chat &&
    chat.companyId === company.id &&
    chat.channelType === "widget" &&
    chat.visitorId === visitorId;
  if (!own) {
    return { ok: false, response: widgetJson({ error: "Chat not found" }, 404) };
  }
  return { ok: true, companyId: company.id, chatId };
}

const messageColumns = {
  id: messages.id,
  chatId: messages.chatId,
  role: messages.role,
  content: messages.content,
  author: messages.author,
  authorDisplayName: messages.authorDisplayName,
  metadata: messages.metadata,
  createdAt: messages.createdAt,
};

/** Ordering key for messages: creation time, then id for equal timestamps. */
export type MessageKey = { createdAt: Date; id: string };

export function isAfter(row: MessageKey, cursor: MessageKey): boolean {
  const delta = row.createdAt.getTime() - cursor.createdAt.getTime();
  return delta > 0 || (delta === 0 && row.id > cursor.id);
}

/** The cursor message, only when it belongs to this chat. */
export async function findCursor(chatId: string, messageId: unknown): Promise<MessageKey | null> {
  if (!isUuid(messageId)) return null;
  const [row] = await db
    .select({ id: messages.id, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
    .limit(1);
  return row ?? null;
}

/** Customer-visible rows (user and assistant) created at or after `since`. */
export async function listVisibleMessagesSince(
  chatId: string,
  since: Date | null,
  limit = WIDGET_MESSAGES_PAGE,
): Promise<MessageRow[]> {
  const visible = and(
    eq(messages.chatId, chatId),
    inArray(messages.role, ["user", "assistant"]),
  );
  return db
    .select(messageColumns)
    .from(messages)
    .where(since ? and(visible, gte(messages.createdAt, since)) : visible)
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(limit);
}

/**
 * Missed messages on reopen: every customer-visible row after the widget's
 * last known message, or the latest page of the transcript without one.
 */
export async function listMissedMessages(
  chatId: string,
  cursor: MessageKey | null,
): Promise<WidgetMessage[]> {
  if (!cursor) {
    const latest = await db
      .select(messageColumns)
      .from(messages)
      .where(
        and(eq(messages.chatId, chatId), inArray(messages.role, ["user", "assistant"])),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(WIDGET_MESSAGES_PAGE);
    return latest.reverse().map(toWidgetMessage);
  }
  // Fetch from the cursor's timestamp and drop rows at or before it, so rows
  // sharing the cursor's timestamp are neither lost nor repeated.
  const rows = await listVisibleMessagesSince(chatId, cursor.createdAt, WIDGET_MESSAGES_PAGE + 50);
  return rows
    .filter((row) => isAfter(row, cursor))
    .slice(0, WIDGET_MESSAGES_PAGE)
    .map(toWidgetMessage);
}

export type WidgetHandoff = {
  status: HandoffRequestStatus | null;
  /** The colleague the request went to, for "… joined the chat" (S62). */
  person: string | null;
};

/** The conversation's latest handoff request, for the widget states (S62). */
export async function latestHandoff(chatId: string): Promise<WidgetHandoff> {
  const [row] = await db
    .select({ status: handoffRequests.status, person: handoffRequests.recipientName })
    .from(handoffRequests)
    .where(eq(handoffRequests.chatId, chatId))
    .orderBy(desc(handoffRequests.createdAt))
    .limit(1);
  return { status: row?.status ?? null, person: row?.person ?? null };
}

// --- Event stream state -------------------------------------------------

/**
 * Rows are re-read this far behind the newest one seen: a row committed late
 * by a transaction (its timestamp is set before commit) is still picked up.
 * `seen` keeps the overlap from emitting anything twice.
 */
export const STREAM_OVERLAP_MS = 5_000;
/** How often the open stream checks for new messages. */
export const POLL_INTERVAL_MS = 2_500;
/** The stream closes after this; EventSource reconnects with Last-Event-ID. */
export const STREAM_LIFETIME_MS = 55_000;
export const STREAM_RECONNECT_MS = 3_000;

export type StreamState = {
  /** Newest creation time seen; the next poll reads from here minus the overlap. */
  highWater: Date;
  seen: Set<string>;
  handoff: HandoffRequestStatus | null | undefined;
};

/**
 * Start state. Every row at or before the cursor (or, without one, every row
 * that exists now) counts as already delivered to the widget.
 */
export function initialStreamState(cursor: MessageKey | null, now: Date): StreamState {
  return {
    highWater: cursor?.createdAt ?? now,
    seen: new Set(cursor ? [cursor.id] : []),
    handoff: undefined,
  };
}

export function pollFrom(state: StreamState): Date {
  return new Date(state.highWater.getTime() - STREAM_OVERLAP_MS);
}

/**
 * Fold one poll into the state. On the first poll `baseline` marks rows at or
 * before it as seen without emitting them.
 */
export function takeNewMessages(
  state: StreamState,
  rows: MessageRow[],
  baseline?: MessageKey,
): WidgetMessage[] {
  const out: WidgetMessage[] = [];
  for (const row of rows) {
    if (state.seen.has(row.id)) continue;
    state.seen.add(row.id);
    if (row.createdAt > state.highWater) state.highWater = row.createdAt;
    if (baseline && !isAfter(row, baseline)) continue;
    if (isOutOfBand(row)) out.push(toWidgetMessage(row));
  }
  return out;
}

export function sseEvent(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
