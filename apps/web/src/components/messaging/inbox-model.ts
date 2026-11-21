/**
 * Inbox (Figma 08a `1:9`) view model: tabs, filters, chips, handoff events and
 * copy. Pure, so the server page and the client panes share one set of rules.
 * Spec: docs/superpowers/specs/2026-10-02-human-handoff.md (decisions 12, 13).
 */
import type { HandoffMode, HandoffRequestStatus } from "@/db/schema";

import type { BrandName } from "@/components/v2/primitives/brand-glyph";
import type { IconName } from "@/components/v2/primitives/icon";
import type { StatusTone } from "@/components/v2/primitives/status-chip";

export type InboxTab = "all" | "waiting" | "escalated";
export const INBOX_TABS: readonly InboxTab[] = ["all", "waiting", "escalated"];

export type InboxSource = "widget" | "whatsapp" | "instagram" | "messenger" | "telegram";
export type InboxSourceFilter = InboxSource | "all";

export const INBOX_SOURCES: readonly InboxSource[] = [
  "widget",
  "whatsapp",
  "instagram",
  "messenger",
  "telegram",
];

export const SOURCE_LABEL: Record<InboxSource, string> = {
  widget: "Website widget",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
};

export const SOURCE_BRAND: Record<InboxSource, BrandName> = {
  widget: "website",
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  telegram: "telegram",
};

/** Customer channels shown in the Inbox. `web` is the legacy widget channel. */
export const CUSTOMER_CHANNELS = [
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
  "widget",
  "web",
] as const;

export function toInboxSource(channelType: string | null): InboxSource {
  switch (channelType) {
    case "whatsapp":
    case "instagram":
    case "messenger":
    case "telegram":
      return channelType;
    default:
      return "widget";
  }
}

export type Chip = { tone: StatusTone; label: string };

/** One list row, preformatted on the server. */
export type InboxConversation = {
  id: string;
  customer: string;
  source: InboxSource;
  /** The customer agent, or "Handed to <name>" once a person was asked. */
  agentLine: string;
  /** Hand icon on the agent line. */
  handoff: boolean;
  time: string;
  snippet: string;
  chip: Chip;
  /** Waiting for you: the handoff expired and nobody answered from the Inbox yet. */
  waiting: boolean;
  /** Escalated: the conversation has had a handoff request, in any state. */
  escalated: boolean;
};

/** The handoff request fields the Inbox reads. */
export type InboxHandoff = {
  id: string;
  status: HandoffRequestStatus;
  mode: HandoffMode;
  reason: string;
  questions: { text: string; askedAt: string }[];
  recipientName: string | null;
  recipientWhatsapp: string | null;
  createdAt: Date;
  notifiedAt: Date | null;
  expiresAt: Date;
  answeredAt: Date | null;
  takenOverAt: Date | null;
  expiredAt: Date | null;
  handedBackAt: Date | null;
  handBackReason: "manual" | "idle" | null;
};

/**
 * Decision 13: an expired request sits in Waiting for you until anyone replies
 * from the Inbox, i.e. until a person message arrives after the expiry.
 */
export function isWaitingForYou(
  latest: { status: HandoffRequestStatus; expiredAt: Date | null } | null,
  lastHumanMessageAt: Date | null,
): boolean {
  if (!latest || latest.status !== "expired") return false;
  if (!lastHumanMessageAt || !latest.expiredAt) return true;
  return lastHumanMessageAt.getTime() <= latest.expiredAt.getTime();
}

export function countTabs(list: readonly InboxConversation[]): Record<InboxTab, number> {
  return {
    all: list.length,
    waiting: list.filter((c) => c.waiting).length,
    escalated: list.filter((c) => c.escalated).length,
  };
}

export function filterConversations(
  list: readonly InboxConversation[],
  filter: { tab: InboxTab; query: string; source: InboxSourceFilter },
): InboxConversation[] {
  const query = filter.query.trim().toLowerCase();
  return list.filter((c) => {
    if (filter.tab === "waiting" && !c.waiting) return false;
    if (filter.tab === "escalated" && !c.escalated) return false;
    if (filter.source !== "all" && c.source !== filter.source) return false;
    if (!query) return true;
    return [c.customer, c.agentLine, c.snippet].some((field) =>
      field.toLowerCase().includes(query),
    );
  });
}

const HANDOFF_CHIP: Record<HandoffRequestStatus, Chip> = {
  open: { tone: "pending", label: "Handed off" },
  answered: { tone: "success", label: "Answered" },
  taken_over: { tone: "live", label: "Taken over" },
  expired: { tone: "needs-you", label: "Expired" },
  handed_back: { tone: "neutral", label: "Handed back" },
};

export function handoffRowChip(status: HandoffRequestStatus): Chip {
  return HANDOFF_CHIP[status];
}

const OPEN_WINDOW_MS = 24 * 3_600_000;

/** Conversations without a handoff: open for 24 h after the last message. */
export function conversationChip(lastActivityAt: Date, now: Date): Chip {
  return now.getTime() - lastActivityAt.getTime() < OPEN_WINDOW_MS
    ? { tone: "live", label: "Open" }
    : { tone: "neutral", label: "Resolved" };
}

// Time. Every string is formatted on the server in the company's time zone, so
// server and client render the same text.

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** List time: the clock today, the weekday within a week, else "24 Sep". */
export function formatListTime(date: Date, now: Date, timeZone: string): string {
  if (parts(date, timeZone) === parts(now, timeZone)) return formatClock(date, timeZone);
  if (now.getTime() - date.getTime() < 6 * 86_400_000) {
    return dateParts(date, timeZone).weekday;
  }
  const { day, month } = dateParts(date, timeZone);
  return `${day} ${month}`;
}

/** en-US short names ("Sep", not en-GB "Sept"), arranged day-first. */
function dateParts(date: Date, timeZone: string) {
  const out = { weekday: "", day: "", month: "" };
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(date)) {
    if (part.type === "weekday" || part.type === "day" || part.type === "month") {
      out[part.type] = part.value;
    }
  }
  return out;
}

/** Details "Started": "Fri 25 Sep, 14:26". */
export function formatStarted(date: Date, timeZone: string): string {
  const { weekday, day, month } = dateParts(date, timeZone);
  return `${weekday} ${day} ${month}, ${formatClock(date, timeZone)}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// Handoff copy.

const IDLE_MINUTES = 30;

function recipientOf(request: InboxHandoff): string | null {
  return request.recipientName?.trim() || null;
}

/** "Handoff sent to Markus Albrecht by WhatsApp", or where else it went. */
function sentPhrase(request: InboxHandoff): string {
  if (request.mode === "team_chat") return "Handoff posted in the team chat";
  const recipient = recipientOf(request);
  if (!recipient) return "Handoff came to the Inbox (no confirmed recipient)";
  return request.recipientWhatsapp
    ? `Handoff sent to ${recipient} by WhatsApp`
    : `Handoff sent to ${recipient}`;
}

export type HandoffEvent = {
  kind: "event";
  id: string;
  at: Date;
  icon: IconName;
  tone: "primary" | "warning" | "muted";
  text: string;
};

/** System lines in the transcript, one per handoff transition. */
export function handoffEvents(request: InboxHandoff, timeZone: string): HandoffEvent[] {
  const recipient = recipientOf(request) ?? "the team";
  const line = (at: Date, text: string) => `${formatClock(at, timeZone)} · ${text}`;
  const events: HandoffEvent[] = [];
  const sentAt = request.notifiedAt ?? request.createdAt;
  events.push({
    kind: "event",
    id: `${request.id}:sent`,
    at: sentAt,
    icon: "hand-helping",
    tone: "primary",
    text: line(sentAt, sentPhrase(request)),
  });
  if (request.answeredAt) {
    events.push({
      kind: "event",
      id: `${request.id}:answered`,
      at: request.answeredAt,
      icon: "user-check",
      tone: "primary",
      text: line(
        request.answeredAt,
        request.recipientWhatsapp ? `${recipient} answered by WhatsApp` : `${recipient} answered`,
      ),
    });
  }
  if (request.takenOverAt) {
    events.push({
      kind: "event",
      id: `${request.id}:taken_over`,
      at: request.takenOverAt,
      icon: "user-check",
      tone: "primary",
      text: line(request.takenOverAt, `${recipient} took over`),
    });
  }
  if (request.expiredAt) {
    events.push({
      kind: "event",
      id: `${request.id}:expired`,
      at: request.expiredAt,
      icon: "clock",
      tone: "warning",
      text: line(
        request.expiredAt,
        recipientOf(request)
          ? `No answer from ${recipient}. Back in the Inbox.`
          : "No answer. Back in the Inbox.",
      ),
    });
  }
  if (request.handedBackAt) {
    events.push({
      kind: "event",
      id: `${request.id}:handed_back`,
      at: request.handedBackAt,
      icon: request.handBackReason === "idle" ? "clock" : "bot",
      tone: request.handBackReason === "idle" ? "primary" : "muted",
      text: line(
        request.handedBackAt,
        request.handBackReason === "idle"
          ? `Takeover ended after ${IDLE_MINUTES} min without a reply. The agent is answering again.`
          : `${recipient} handed the chat back to the agent.`,
      ),
    });
  }
  return events;
}

/** Messages and events in time order; an event lands after a message with the same time. */
export function buildTimeline<M extends { kind: "message"; at: Date }>(
  messages: readonly M[],
  events: readonly HandoffEvent[],
): (M | HandoffEvent)[] {
  const items: (M | HandoffEvent)[] = [...messages, ...events];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = a.item.at.getTime() - b.item.at.getTime();
      if (diff !== 0) return diff;
      if (a.item.kind !== b.item.kind) return a.item.kind === "message" ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Body of the Human handoff card. */
export function handoffNarrative(
  request: InboxHandoff,
  ctx: { customer: string; company: string; timeZone: string },
): string {
  const clock = (d: Date) => formatClock(d, ctx.timeZone);
  const recipient = recipientOf(request);
  const sentAt = request.notifiedAt ?? request.createdAt;
  const sent =
    request.mode === "team_chat"
      ? `Posted in the team chat at ${clock(sentAt)}.`
      : recipient
        ? `Sent to ${recipient}${request.recipientWhatsapp ? " by WhatsApp" : ""} at ${clock(sentAt)}.`
        : `No confirmed recipient, so it came straight to the Inbox at ${clock(sentAt)}.`;
  const who = recipient ?? "The team";

  switch (request.status) {
    case "open":
      return `${sent} Waiting for an answer until ${clock(request.expiresAt)}.`;
    case "answered":
      return request.answeredAt
        ? `${sent} ${who} answered at ${clock(request.answeredAt)}.`
        : sent;
    case "taken_over":
      return request.takenOverAt
        ? `${who} took over at ${clock(request.takenOverAt)}. The agent is paused until the chat is handed back.`
        : sent;
    case "expired":
      return `${sent} The link expired at ${clock(request.expiredAt ?? request.expiresAt)} with no answer, so it came back to the Inbox. Answer ${firstName(ctx.customer)} here as ${ctx.company}.`;
    case "handed_back": {
      const tookOver = request.takenOverAt
        ? `${who} took over at ${clock(request.takenOverAt)}.`
        : sent;
      if (!request.handedBackAt) return tookOver;
      return request.handBackReason === "idle"
        ? `${tookOver} No message from ${recipient ?? "the team"} for ${IDLE_MINUTES} min, so the chat went back to the agent at ${clock(request.handedBackAt)} with the full transcript.`
        : `${tookOver} The chat went back to the agent at ${clock(request.handedBackAt)}.`;
    }
  }
}

/** Footer line of the Customer question card. */
export function questionFooter(
  request: InboxHandoff,
  timeZone: string,
): { icon: IconName; text: string } {
  const clock = (d: Date) => formatClock(d, timeZone);
  const who = recipientOf(request) ?? "the team";
  switch (request.status) {
    case "open":
      return { icon: "clock", text: `Waiting for ${who} · link expires at ${clock(request.expiresAt)}` };
    case "answered":
      return {
        icon: "circle-check",
        text: `Answered by ${who}${request.answeredAt ? ` · ${clock(request.answeredAt)}` : ""}`,
      };
    case "taken_over":
      return {
        icon: "user-check",
        text: `${who} took over${request.takenOverAt ? ` at ${clock(request.takenOverAt)}` : ""}`,
      };
    case "expired":
      return { icon: "clock", text: `Link expired at ${clock(request.expiredAt ?? request.expiresAt)}` };
    case "handed_back":
      return {
        icon: "bot",
        text:
          request.handBackReason === "idle"
            ? `Handed back to the agent automatically${request.handedBackAt ? ` at ${clock(request.handedBackAt)}` : ""}`
            : `Handed back to the agent${request.handedBackAt ? ` at ${clock(request.handedBackAt)}` : ""}`,
      };
  }
}

export type ComposerMode = "reply" | "takeover";

/**
 * The Inbox is read-only except for two cases: answering Waiting for you as
 * the company (decision 13), and writing during a takeover.
 */
export function composerMode(
  status: HandoffRequestStatus | null,
  waiting: boolean,
): ComposerMode | null {
  if (status === "taken_over") return "takeover";
  if (status === "expired" && waiting) return "reply";
  return null;
}

/** "knowledge_base_search" -> "Knowledge base search". */
export function humanizeTool(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
