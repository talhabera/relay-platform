import type { BrandName } from "@/components/v2/primitives/brand-glyph";
import type { HandoffCardState } from "@/components/v2/client";
import type { QuickLinkView } from "@/app/api/h/[token]/quick-link";
import type { WidgetMessage } from "@/app/api/widget/[id]/widget-messages";

/**
 * The quick-link page (S69, Figma 11c `500:69277`) as pure state: which frame
 * the page shows for a given API view, plus the copy each frame needs. The
 * page component only renders what this returns, so every frame is testable
 * without a browser.
 */

/** The view as the browser receives it from `GET /api/h/[token]`. */
export type QuickLinkPayload = QuickLinkView;
export type QuickLinkMessage = WidgetMessage;

/**
 * Figma frames: open (and replying, a client-side sub-state of open), sent,
 * taken-over, handed-back, expired. `closed` is the page after Done once the
 * link no longer shows the conversation.
 */
export type QuickLinkScreen = "open" | "sent" | "taken-over" | "handed-back" | "expired" | "closed";

export function quickLinkScreen(view: Pick<QuickLinkPayload, "request" | "link">): QuickLinkScreen {
  const { request, link } = view;
  switch (request.status) {
    case "taken_over":
      return "taken-over";
    case "handed_back":
      return link.canView ? "handed-back" : link.isClosed ? "closed" : "expired";
    case "answered":
      return link.isClosed && !link.canView ? "closed" : "sent";
    case "expired":
      return "expired";
    case "open":
      if (link.isClosed) return "closed";
      return link.isExpired || !link.canAnswer ? "expired" : "open";
  }
}

/** Card state per frame (Handoff request card, 02 `457:61810`). */
export const CARD_STATE: Record<QuickLinkScreen, HandoffCardState> = {
  open: "open",
  sent: "answered",
  "taken-over": "taken-over",
  "handed-back": "handed-back",
  expired: "expired",
  closed: "answered",
};

/** "13:46" in the company's timezone, so server and browser render the same text. */
export function formatClock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** Card chip while open: "Customer waiting 6 min". */
export function waitingText(createdAtIso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 60_000));
  if (minutes < 1) return "Customer waiting";
  if (minutes < 60) return `Customer waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Customer waiting ${hours} h ${minutes % 60} min`;
}

/** Link lifetime in hours for the expired notice ("expire 2 h after sending"). */
export function linkLifetimeText(createdAtIso: string, expiresAtIso: string): string {
  const minutes = Math.round((new Date(expiresAtIso).getTime() - new Date(createdAtIso).getTime()) / 60_000);
  if (minutes <= 0) return "";
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

const CHANNELS: Record<string, { label: string; glyph: BrandName }> = {
  widget: { label: "Website widget", glyph: "website" },
  web: { label: "Website widget", glyph: "website" },
  whatsapp: { label: "WhatsApp", glyph: "whatsapp" },
  instagram: { label: "Instagram", glyph: "instagram" },
  messenger: { label: "Messenger", glyph: "messenger" },
  telegram: { label: "Telegram", glyph: "telegram" },
};

export function channelOf(channel: string | null | undefined): { label: string; glyph: BrandName } {
  return (channel && CHANNELS[channel]) || { label: "Chat", glyph: "website" };
}

/**
 * The API does not return the customer's name, so the page says "the
 * customer" and the card's customer row names the channel.
 */
export const CUSTOMER = "Customer";

/** Person on the link: the request's recipient, or a neutral "You". */
export function personName(view: Pick<QuickLinkPayload, "request">): string {
  return view.request.recipientName?.trim() || "You";
}

/** Handoff header lock line. Desktop names the person the link is for. */
export function headerLinkText(
  view: Pick<QuickLinkPayload, "request" | "link">,
  timeZone: string,
  size: "mobile" | "desktop",
): string {
  const at = formatClock(view.request.expiresAt, timeZone);
  const name = view.request.recipientName?.trim();
  const lead = size === "desktop" && name ? `Secure link for ${name}` : "Secure link";
  if (view.link.isClosed) return `${lead} · closed`;
  return view.link.isExpired ? `${lead} · expired at ${at}` : `${lead} · expires ${at}`;
}

/** Card status line per frame. */
export function cardStatusText(view: QuickLinkPayload, timeZone: string): string | undefined {
  const { request } = view;
  switch (quickLinkScreen(view)) {
    case "sent":
    case "closed":
      return request.answeredAt
        ? `Answered by ${personName(view)} · ${formatClock(request.answeredAt, timeZone)}`
        : `Answered by ${personName(view)}`;
    case "expired":
      return `Link expired at ${formatClock(request.expiresAt, timeZone)}`;
    case "taken-over":
      return "You're chatting live · the agent is paused";
    case "handed-back": {
      const at = formatClock(request.handedBackAt, timeZone);
      return request.handBackReason === "idle"
        ? `Handed back to the agent automatically at ${at}`
        : `Handed back to the agent at ${at}`;
    }
    default:
      return undefined;
  }
}

/** Sent banner (11c sent): who got the answer and how. */
export function sentBanner(view: QuickLinkPayload, timeZone: string): { title: string; detail: string } {
  const at = formatClock(view.sent?.createdAt ?? view.request.answeredAt, timeZone);
  const title = at ? `Sent to the customer at ${at}` : "Sent to the customer";
  const detail =
    view.request.replyMode === "agent"
      ? `${view.agent?.name ?? "The agent"} phrased your answer for the customer.`
      : `They see your name: ${sentAsName(view)}`;
  return { title, detail };
}

/** How a person's verbatim message is signed: "Markus Albrecht · Acme GmbH". */
export function sentAsName(view: Pick<QuickLinkPayload, "request" | "company">): string {
  const name = personName(view);
  return view.company.name ? `${name} · ${view.company.name}` : name;
}

/** Live banner (taken-over) and agent-back banner (handed-back). */
export function liveBanner(view: QuickLinkPayload, timeZone: string, idleMinutes: number): { title: string; detail: string } {
  const { request } = view;
  if (request.status === "handed_back") {
    const at = formatClock(request.handedBackAt, timeZone);
    return {
      title: "The agent is back in the chat",
      detail:
        request.handBackReason === "idle"
          ? `No message from you for ${idleMinutes} min, so the chat went back to the agent at ${at} with the full transcript.`
          : `You handed the chat back to the agent at ${at}. It has the full transcript.`,
    };
  }
  const since = formatClock(request.takenOverAt, timeZone);
  return {
    title: "You're in the chat with the customer",
    detail: `The agent is paused since ${since}. Your messages go out with your name. With no message from you for ${idleMinutes} min, the chat goes back to the agent.`,
  };
}

/** Merge streamed messages into the transcript: by id, in time order. */
export function mergeMessages(current: QuickLinkMessage[], incoming: QuickLinkMessage[]): QuickLinkMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
}

/** Customer-visible author line for one transcript message. */
export function messageAuthor(message: QuickLinkMessage, view: Pick<QuickLinkPayload, "agent">): string {
  if (message.role === "user") return CUSTOMER;
  if (message.author === "human") return message.authorDisplayName ?? "Team";
  return view.agent?.name ?? "Agent";
}

/** Initials for a name: "Markus Albrecht" -> "MA". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}
