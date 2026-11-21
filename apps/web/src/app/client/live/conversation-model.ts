/**
 * Live conversation-open sheet (Figma 11b `11/live/conversation-open`,
 * preview `11/live/preview`) view model. Pure: the loader passes rows in.
 */
import {
  buildTimeline,
  conversationChip,
  formatClock,
  handoffEvents,
  handoffNarrative,
  handoffRowChip,
  SOURCE_BRAND,
  SOURCE_LABEL,
  type Chip,
  type InboxHandoff,
  type InboxSource,
} from "@/components/messaging/inbox-model";
import type { BrandName } from "@/components/v2/primitives/brand-glyph";
import type { IconName } from "@/components/v2/primitives/icon";

import { formatWaited, inboxHref } from "./live-model";

export type SheetTranscriptItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      author: string;
      time: string;
      text: string;
    }
  | { kind: "event"; id: string; icon: IconName; text: string };

export type SheetBanner = {
  /** "Waiting for your answer" (client) or "Waiting for Markus Albrecht" (preview). */
  title: string;
  question: string | null;
  narrative: string;
  /** "Customer waiting 6 min". */
  waited: string;
};

export type ConversationView = {
  chatId: string;
  customer: string;
  meta: string;
  brand: BrandName;
  chip: Chip;
  /** Only while a handoff request is open. */
  banner: SheetBanner | null;
  started: string | null;
  transcript: SheetTranscriptItem[];
  /** Preview: Open in Inbox replaces Answer now. */
  inboxHref: string;
};

export type ConversationInput = {
  chatId: string;
  customer: string;
  source: InboxSource;
  agentName: string | null;
  companyName: string;
  messages: readonly {
    id: string;
    role: "user" | "assistant";
    author: "agent" | "human" | null;
    authorDisplayName: string | null;
    content: string;
    createdAt: Date;
  }[];
  /** Oldest first. */
  requests: readonly InboxHandoff[];
  chatCreatedAt: Date;
  timeZone: string;
  now: Date;
  readOnly: boolean;
};

export function buildConversationView(input: ConversationInput): ConversationView {
  const tz = input.timeZone;
  const agent = input.agentName ?? "Customer agent";
  const latest = input.requests.at(-1) ?? null;

  const items = input.messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => {
      const person = m.role === "assistant" && m.author === "human";
      return {
        kind: "message" as const,
        at: m.createdAt,
        id: m.id,
        role: m.role,
        author:
          m.role === "user"
            ? input.customer
            : person
              ? `${m.authorDisplayName ?? "Team"} · ${input.companyName}`
              : agent,
        time: formatClock(m.createdAt, tz),
        text: m.content,
      };
    });
  const events = input.requests.flatMap((r) => handoffEvents(r, tz));
  const transcript: SheetTranscriptItem[] = buildTimeline(items, events).map((item) =>
    item.kind === "event"
      ? { kind: "event", id: item.id, icon: item.icon, text: item.text }
      : { kind: "message", id: item.id, role: item.role, author: item.author, time: item.time, text: item.text },
  );

  const open = latest?.status === "open" ? latest : null;
  const banner: SheetBanner | null = open
    ? {
        title: input.readOnly
          ? `Waiting for ${open.recipientName?.trim() || "the team"}`
          : "Waiting for your answer",
        question: open.questions[0]?.text?.trim() || null,
        narrative: handoffNarrative(open, { customer: input.customer, company: input.companyName, timeZone: tz }),
        waited: `Customer waiting ${formatWaited(open.createdAt, input.now)}`,
      }
    : null;

  const lastAt = input.messages.at(-1)?.createdAt ?? input.chatCreatedAt;
  const chip: Chip = open
    ? { tone: "needs-you", label: "Waiting for you" }
    : latest
      ? handoffRowChip(latest.status)
      : conversationChip(lastAt, input.now);

  const first = input.messages[0]?.createdAt ?? null;
  return {
    chatId: input.chatId,
    customer: input.customer,
    meta: [input.agentName, SOURCE_LABEL[input.source]].filter(Boolean).join(" · "),
    brand: SOURCE_BRAND[input.source],
    chip,
    banner,
    started: first ? `Started ${formatClock(first, tz)}` : null,
    transcript,
    inboxHref: inboxHref(input.chatId),
  };
}
