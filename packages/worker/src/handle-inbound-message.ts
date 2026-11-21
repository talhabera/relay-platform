import { convertToModelMessages, generateText, stepCountIs } from "ai";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  agentQuestions,
  agents,
  channels,
  chats,
  companies,
  integrations,
  knowledgeBase,
  messages,
} from "@relay/db";
import { getModel } from "./ai/provider";
import { buildSystemPrompt } from "./ai/system-prompt";
import { selectTools } from "./ai/tools";
import { getChatHistory, saveAssistantMessage } from "./ai/chat-persistence";
import { checkTokenBudget, recordTokenUsage } from "./ai/token-limiter";
import { dbMessagesToUIMessages } from "./operator/messages";
import { sendMessage } from "./integrations/messaging";
import { enqueue } from "./serial-queue";
import { handoffTurnOptions, loadHandoffRuntime } from "./handoff/runtime";
import { isChatTakenOver } from "./handoff/store";
import { loadLeadCapture } from "./leads/lead-capture";
import { recordFirstResponse } from "./leads/first-response";

export type InboundRequest = {
  platform: "whatsapp" | "instagram";
  chatId: string;
  channelId: string;
};

/**
 * The model's whole input on this path is text written by an anonymous person
 * who messaged the business, so a prompt injection would otherwise be able to
 * drive a message from the verified business number to a recipient of the
 * attacker's choosing, or post a public Instagram comment. This is a security
 * boundary, not tidying: the reply channel is already fixed by the run, so the
 * model never needs a send tool to answer. Read-only tools stay.
 *
 * Shared with the comment auto-reply path, which faces the same untrusted
 * author. One list, never a copy.
 *
 * Second layer, deliberately: `selectTools` no longer registers a send tool
 * unless the caller passes `allowSendTools`, and neither of these paths does.
 * This list stays so that turning that flag on here would still not hand the
 * model a send tool by accident.
 */
export const INBOUND_EXCLUDED_TOOLS = [
  "sendPlatformMessage",
  "replyToInstagramComment",
  "sendInstagramPrivateReply",
] as const;

/**
 * How many past messages to feed the model. A WhatsApp thread with one
 * customer is a single `chats` row that lives forever, so an unbounded history
 * makes turn N cost O(N) tokens and eventually overflows the context window —
 * silently, because the failure is swallowed by the fire-and-forget queue and
 * the customer simply never gets a reply.
 */
const INBOUND_HISTORY_LIMIT = 40;

/**
 * Drop leading rows until the window starts on a user turn.
 *
 * A blind `slice(-40)` cuts at a fixed offset regardless of role. History is
 * ascending and the just-persisted inbound turn is always last, so a cleanly
 * alternating thread has an odd total and the cut lands on an assistant row
 * once the conversation passes the limit. The Messages API requires
 * `messages[0].role === "user"`, so `generateText` would throw a 400 that the
 * fire-and-forget queue swallows — the customer silently never gets a reply,
 * exactly the failure the limit exists to prevent. Trimming by role rather
 * than nudging the limit to an odd number also survives a tool row or two
 * consecutive user messages, which break any parity assumption.
 */
export function dropUntilFirstUser<T extends { role: string }>(history: T[]): T[] {
  const first = history.findIndex((message) => message.role === "user");
  // -1 means the window holds no user turn at all, which cannot happen here:
  // the inbound message was just persisted as a user turn and is the last row.
  // Return nothing rather than hand the API an assistant-first array anyway.
  return first < 0 ? [] : history.slice(first);
}

/**
 * Queue an inbound run behind whatever is already running for this chat, and
 * return immediately. The HTTP handler answers 202 without waiting.
 */
export function enqueueInboundRun(request: InboundRequest): void {
  enqueue(`chat:${request.chatId}`, () => runInboundMessage(request));
}

export function credentialsFor(
  platform: InboundRequest["platform"],
  config: { phoneNumberId?: string; accountId?: string; accessToken?: string }
): { phoneNumberId: string; accessToken: string } | { accountId: string; accessToken: string } | null {
  if (!config.accessToken) return null;

  if (platform === "whatsapp") {
    return config.phoneNumberId
      ? { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken }
      : null;
  }

  return config.accountId
    ? { accountId: config.accountId, accessToken: config.accessToken }
    : null;
}

/**
 * Answer one inbound message: build the customer agent exactly as
 * `handleCustomerChat` does, run it to completion, save the reply, and send it
 * back through the platform.
 *
 * Never throws — the caller is a fire-and-forget queue, so every failure is
 * logged and swallowed. The inbound message stays persisted either way, so an
 * unanswered turn is visible rather than lost.
 */
export async function runInboundMessage(
  request: InboundRequest
): Promise<void> {
  try {
    await answerInbound(request);
  } catch (cause) {
    console.error("[Inbound] run failed", request.chatId, cause);
    await raiseAgentError(request, cause);
  }
}

export const AGENT_ERROR_QUESTION =
  "Karşılama ajanı bir mesaja yanıt veremedi. Sohbeti açıp elle yanıtla.";

/**
 * Surface an unanswered customer in Needs you (and push) through an open
 * agent question on the chat. One open question per chat is enough. The
 * exception text never lands in the row (it may carry secrets); it stays in
 * the log. Never throws.
 */
export async function raiseAgentError(
  request: InboundRequest,
  _cause?: unknown,
): Promise<void> {
  try {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, request.chatId),
    });
    if (!chat?.agentId || !chat.companyId) return;

    const open = await db.query.agentQuestions?.findFirst({
      where: and(
        eq(agentQuestions.chatId, request.chatId),
        eq(agentQuestions.status, "open"),
      ),
    });
    if (open) return;

    await db.insert(agentQuestions).values({
      companyId: chat.companyId,
      agentId: chat.agentId,
      chatId: request.chatId,
      question: AGENT_ERROR_QUESTION,
      suggestedAnswers: [],
      status: "open",
    });
  } catch (error) {
    console.error("[Inbound] could not raise the agent error", request.chatId, error);
  }
}

async function answerInbound(request: InboundRequest): Promise<void> {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, request.channelId),
  });

  if (!channel || channel.status !== "active") {
    console.warn("[Inbound] channel is gone or inactive", request.channelId);
    return;
  }

  // The queue can be deep, so a channel that was opted in when this run was
  // queued may be opted out by the time it reaches the front. Re-check the
  // live flag, not the queued snapshot.
  if (channel.config?.autoReply !== true) {
    console.warn("[Inbound] auto reply is off", channel.id);
    return;
  }

  // An inbound message has no signed-in user: the channel pays for itself.
  const budget = await checkTokenBudget(channel.id, "channel");
  if (!budget.allowed) {
    console.warn("[Inbound] weekly channel budget spent", channel.id);
    return;
  }

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, request.chatId),
  });

  if (!chat?.visitorId || !chat.agentId) {
    console.warn("[Inbound] chat is not an inbound conversation", request.chatId);
    return;
  }

  // This is the entry point's own check. The web route derives the chat and
  // the channel from one lookup, but a caller that paired them wrongly would
  // answer one company's customer out of another company's number and bill it
  // to that channel's budget.
  if (chat.agentId !== channel.agentId) {
    console.warn(
      "[Inbound] chat does not belong to this channel",
      request.chatId,
      channel.id
    );
    return;
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, chat.agentId),
  });

  if (!agent || agent.kind === "operator") {
    console.warn("[Inbound] no customer agent for chat", request.chatId);
    return;
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, chat.companyId),
  });

  if (!company) {
    console.warn("[Inbound] company is gone", chat.companyId);
    return;
  }

  // A person has taken over: the agent stays quiet until hand-back. The
  // inbound message is already stored, so the person sees it.
  const scope = { id: agent.id, companyId: company.id };
  const handoff = await loadHandoffRuntime(scope, chat.id);
  if (handoff.paused) {
    console.info("[Inbound] a person has taken over", request.chatId);
    return;
  }
  const handoffTurn = handoffTurnOptions(handoff, scope, company.name, () => chat.id);

  const enabledIntegrations = await db.query.integrations.findMany({
    where: eq(integrations.companyId, company.id),
  });

  const integrationTypes = enabledIntegrations
    .filter((i) => i.status === "connected")
    .map((i) => i.type);

  const knowledgeEntries = await db.query.knowledgeBase.findMany({
    where: and(
      eq(knowledgeBase.agentId, agent.id),
      eq(knowledgeBase.status, "ready")
    ),
  });

  const agentChannels = await db.query.channels.findMany({
    where: eq(channels.agentId, agent.id),
  });

  const selected = selectTools(integrationTypes, agent.id, agentChannels, {
    leadCapture: await loadLeadCapture(agent, () => chat.id),
    askHuman: handoffTurn.askHuman,
  });
  const tools = Object.fromEntries(
    Object.entries(selected).filter(
      ([name]) =>
        !(INBOUND_EXCLUDED_TOOLS as readonly string[]).includes(name)
    )
  );

  const systemPrompt = buildSystemPrompt({
    agent,
    company,
    knowledgeEntries,
    toolNames: Object.keys(tools),
    handoffSection: handoffTurn.handoffSection,
  });

  // The inbound message is already persisted, so history is the whole input.
  // Trimmed here rather than in `getChatHistory`, whose other callers are fed
  // a client-bounded message list and rely on the unmodified signature.
  const history = dropUntilFirstUser(
    (await getChatHistory(request.chatId)).slice(-INBOUND_HISTORY_LIMIT)
  );
  const modelMessages = await convertToModelMessages(
    dbMessagesToUIMessages(history)
  );

  const { text, usage } = await generateText({
    model: getModel(agent.model),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  });

  const totalTokens = usage.totalTokens ?? 0;
  if (totalTokens > 0) {
    await recordTokenUsage(channel.id, "channel", totalTokens);
  }

  if (!text.trim()) {
    console.warn("[Inbound] model produced no text", request.chatId);
    return;
  }

  // A takeover can start while the model runs. The person now owns the
  // conversation, so this reply is dropped rather than sent over them.
  if (await isChatTakenOver(request.chatId)) {
    console.info("[Inbound] taken over during the run", request.chatId);
    return;
  }

  const credentials = credentialsFor(request.platform, channel.config ?? {});
  if (!credentials) {
    console.error("[Inbound] channel config is missing credentials", channel.id);
    await raiseAgentError(request);
    return;
  }

  // Save before sending: a reply that went out but was never stored would be
  // invisible in the transcript and re-answered on the next turn.
  const messageId = await saveAssistantMessage(request.chatId, text);

  const result = await sendMessage(
    request.platform,
    chat.visitorId,
    text,
    credentials
  );

  if (!result.success || !result.messageId) {
    console.error("[Inbound] send failed", result.error);
    await raiseAgentError(request);
    return;
  }

  // Merged, not replaced: a delivery-status webhook writes onto this same row
  // as soon as WhatsApp reports the send, and saveAssistantMessage may have
  // left its own fields there.
  await db
    .update(messages)
    .set({
      metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(
        { platformMessageId: result.messageId }
      )}::jsonb`,
    })
    .where(eq(messages.id, messageId));

  try {
    await recordFirstResponse(request.chatId);
  } catch (error) {
    console.error("[Inbound] could not record the first response", request.chatId, error);
  }
}
