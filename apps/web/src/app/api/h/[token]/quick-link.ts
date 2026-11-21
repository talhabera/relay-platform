import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, chats, companies, messages, HANDOFF_REPLY_MODES } from "@/db/schema";
import { handoffLinkState, type HandoffLinkState } from "@/lib/handoff/link";
import type { HandoffRequest } from "@/lib/handoff/requests";
import { getAgentHandoffSettings, defaultHandoffSettings } from "@/lib/handoff/settings";
import { isTyping } from "@/lib/handoff/typing";
import { handoffAnswerSchema } from "@/lib/handoff/validators";
import {
  listMissedMessages,
  toWidgetMessage,
  type WidgetMessage,
} from "@/app/api/widget/[id]/widget-messages";

// The quick-link API (S36, handoff spec decision 8). The token in the URL is
// the only credential: the recipient may be someone outside the company with
// no session. Nothing here returns the recipient's number or the token hash.

/** Never cached, never sent on as a referrer, never indexed: the URL is a secret. */
export const QUICK_LINK_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export function quickLinkJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...QUICK_LINK_HEADERS, ...extra } });
}

export function notFound(): Response {
  return quickLinkJson({ error: "not_found" }, 404);
}

/** What one POST to `/api/h/[token]` asks for. */
export const quickLinkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    text: handoffAnswerSchema.shape.text,
    replyMode: z.enum(HANDOFF_REPLY_MODES),
  }),
  z.object({ action: z.literal("take_over") }),
  z.object({ action: z.literal("message"), text: handoffAnswerSchema.shape.text }),
  z.object({ action: z.literal("hand_back") }),
  z.object({ action: z.literal("done") }),
  z.object({ action: z.literal("typing") }),
]);
export type QuickLinkAction = z.infer<typeof quickLinkActionSchema>;

export type QuickLinkState = HandoffLinkState & {
  /** While taken over: "Hand back to agent". */
  canHandBack: boolean;
  /** The person pressed Done. */
  isClosed: boolean;
  /**
   * The page may show the conversation: before the deadline and Done, or for
   * as long as the person holds a takeover.
   */
  canView: boolean;
};

export function quickLinkState(request: HandoffRequest, now: Date): QuickLinkState {
  const link = handoffLinkState(request, now);
  const isClosed = request.linkClosedAt !== null;
  const takenOver = request.status === "taken_over";
  return {
    ...link,
    canHandBack: takenOver,
    isClosed,
    canView: takenOver || (!isClosed && now.getTime() < request.expiresAt.getTime()),
  };
}

/** The request fields the page may show; no recipient number, no token hash. */
export function publicRequest(request: HandoffRequest) {
  return {
    id: request.id,
    status: request.status,
    mode: request.mode,
    reason: request.reason,
    confidence: request.confidence,
    questions: request.questions,
    suggestedReplies: request.suggestedReplies,
    recipientName: request.recipientName,
    answer: request.answer,
    replyMode: request.replyMode,
    answeredAt: request.answeredAt?.toISOString() ?? null,
    takenOverAt: request.takenOverAt?.toISOString() ?? null,
    handedBackAt: request.handedBackAt?.toISOString() ?? null,
    handBackReason: request.handBackReason,
    expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * The message that actually reached the customer for this request's answer:
 * the agent's follow-up ("let the agent phrase it") or the person's verbatim
 * message. Null until it exists.
 */
async function findSentMessage(request: HandoffRequest): Promise<WidgetMessage | null> {
  if (request.status === "open" || !request.answeredAt) return null;
  const match =
    request.replyMode === "agent"
      ? sql`${messages.metadata} ->> 'handoffRequestId' = ${request.id}`
      : and(eq(messages.author, "human"), eq(messages.createdAt, request.answeredAt));
  const [row] = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      role: messages.role,
      content: messages.content,
      author: messages.author,
      authorDisplayName: messages.authorDisplayName,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.chatId, request.chatId), match))
    .limit(1);
  return row ? toWidgetMessage(row) : null;
}

/** Everything the quick-link page (S69) renders. Read-only: opening is idempotent. */
export async function loadQuickLinkView(request: HandoffRequest, now: Date = new Date()) {
  const state = quickLinkState(request, now);
  const [company, chat, agent] = await Promise.all([
    db.query.companies.findFirst({ where: eq(companies.id, request.companyId) }),
    db.query.chats.findFirst({ where: eq(chats.id, request.chatId) }),
    request.agentId
      ? db.query.agents.findFirst({ where: eq(agents.id, request.agentId) })
      : Promise.resolve(undefined),
  ]);
  const settings = agent
    ? await getAgentHandoffSettings({ id: agent.id, companyId: request.companyId })
    : defaultHandoffSettings({ id: "", companyId: request.companyId });

  const [transcript, sent] = state.canView
    ? await Promise.all([listMissedMessages(request.chatId, null), findSentMessage(request)])
    : [null, null];

  return {
    request: publicRequest(request),
    link: state,
    defaultReply: settings.defaultReply,
    company: { name: company?.name ?? "" },
    agent: agent ? { name: agent.name } : null,
    channel: chat?.channelType ?? null,
    transcript,
    sent,
    typing: { customer: state.canView && isTyping(request.chatId, "customer") },
  };
}

export type QuickLinkView = Awaited<ReturnType<typeof loadQuickLinkView>>;
