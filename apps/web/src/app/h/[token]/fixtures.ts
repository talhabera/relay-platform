import type { QuickLinkMessage, QuickLinkPayload, QuickLinkScreen } from "./screen";

/**
 * Figma 11c fixtures (Acme GmbH, Markus Albrecht, weekend cleaning question)
 * for tests and the dev-only `/h/fixture?state=…` page. Times are Europe/Berlin.
 */
export const FIXTURE_TIME_ZONE = "Europe/Berlin";
export const FIXTURE_TOKEN = "fixture";
export const FIXTURE_NOW = new Date("2026-10-03T09:52:00Z");

const at = (hhmm: string) => `2026-10-03T${String(Number(hhmm.slice(0, 2)) - 2).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;

const QUESTION = "Can we offer weekend cleaning for 1,200 m², twice a week, from Mon 5 Oct?";
const ANSWER =
  "Yes, we can. Weekend cleaning twice a week for 1,200 m² starts at €2,450 a month. Could we visit on Tue 29 Sep at 10:00 to confirm the details?";

const msg = (id: string, role: "user" | "assistant", time: string, content: string, human = false): QuickLinkMessage => ({
  id,
  role,
  content,
  author: role === "user" ? null : human ? "human" : "agent",
  authorDisplayName: human ? "Markus Albrecht · Acme GmbH" : null,
  createdAt: at(time),
});

const TRANSCRIPT: QuickLinkMessage[] = [
  msg("m1", "user", "11:43", "Hi, I'm Lukas Brenner, Facility Manager at Isar Data GmbH."),
  msg("m2", "assistant", "11:43", "Hi Lukas, welcome to Acme. How can I help?"),
  msg("m3", "user", "11:44", "Do you offer weekend cleaning?"),
  msg("m4", "user", "11:45", "1,200 m², twice a week, from Mon 5 Oct."),
  msg("m5", "assistant", "11:46", "A colleague will confirm the weekend rate in a few minutes."),
  msg("m6", "user", "11:47", "Great, thanks. I'll wait."),
];

const BASE: QuickLinkPayload = {
  request: {
    id: "req-fixture",
    status: "open",
    mode: "takeover",
    reason: "Why you: weekend rates are not in the price list.",
    confidence: 40,
    questions: [{ text: QUESTION, askedAt: at("11:46") }],
    suggestedReplies: [
      "Yes, send the weekend rate and offer a site visit",
      "Ask for their floor plan first",
      "I'll call them today",
    ],
    recipientName: "Markus Albrecht",
    answer: null,
    replyMode: null,
    answeredAt: null,
    takenOverAt: null,
    handedBackAt: null,
    handBackReason: null,
    expiresAt: at("13:46"),
    createdAt: at("11:46"),
  },
  link: {
    canAnswer: true,
    canTakeOver: true,
    canWriteAsPerson: false,
    isExpired: false,
    canHandBack: false,
    isClosed: false,
    canView: true,
  },
  defaultReply: "person",
  company: { name: "Acme GmbH" },
  agent: { name: "Acme Website Assistant" },
  channel: "widget",
  transcript: TRANSCRIPT,
  sent: null,
  typing: { customer: false },
};

const SENT = msg("m7", "assistant", "11:49", ANSWER, true);
const FOLLOW = msg("m8", "assistant", "11:49", "Thanks, Markus. Lukas, shall I book Tue 29 Sep, 10:00?");
const TYPING_TURN = msg("m9", "user", "11:50", "Yes, please book it.");

export const QUICK_LINK_FIXTURES: Record<QuickLinkScreen, QuickLinkPayload> = {
  open: BASE,
  sent: {
    ...BASE,
    request: { ...BASE.request, status: "answered", answer: ANSWER, replyMode: "person", answeredAt: at("11:49") },
    link: { ...BASE.link, canAnswer: false },
    transcript: [...TRANSCRIPT, SENT, FOLLOW],
    sent: SENT,
  },
  "taken-over": {
    ...BASE,
    request: { ...BASE.request, status: "taken_over", takenOverAt: at("11:50") },
    link: { ...BASE.link, canAnswer: false, canTakeOver: false, canWriteAsPerson: true, canHandBack: true },
    transcript: [...TRANSCRIPT, SENT, FOLLOW],
    typing: { customer: true },
  },
  "handed-back": {
    ...BASE,
    request: {
      ...BASE.request,
      status: "handed_back",
      takenOverAt: at("11:50"),
      handedBackAt: at("12:24"),
      handBackReason: "idle",
    },
    link: { ...BASE.link, canAnswer: false, canTakeOver: false },
    transcript: [...TRANSCRIPT, SENT, FOLLOW, TYPING_TURN],
  },
  expired: {
    ...BASE,
    request: { ...BASE.request, status: "expired" },
    link: { ...BASE.link, canAnswer: false, canTakeOver: false, isExpired: true, canView: false },
    transcript: null,
  },
  closed: {
    ...BASE,
    request: { ...BASE.request, status: "answered", answer: ANSWER, replyMode: "person", answeredAt: at("11:49") },
    link: { ...BASE.link, canAnswer: false, canTakeOver: false, isClosed: true, canView: false },
    transcript: null,
  },
};

export function isQuickLinkScreen(value: string | undefined): value is QuickLinkScreen {
  return value !== undefined && Object.prototype.hasOwnProperty.call(QUICK_LINK_FIXTURES, value);
}
