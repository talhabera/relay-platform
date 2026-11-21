import { convertToModelMessages, generateText, stepCountIs } from "ai";
import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  channels,
  chats,
  companies,
  db,
  integrations,
  knowledgeBase,
  messages,
  type MessageMetadata,
} from "@relay/db";
import { getModel } from "../ai/provider";
import { buildSystemPrompt } from "../ai/system-prompt";
import { selectTools } from "../ai/tools";
import { getChatHistory, saveAssistantMessage } from "../ai/chat-persistence";
import { checkTokenBudget, recordTokenUsage } from "../ai/token-limiter";
import { dbMessagesToUIMessages } from "../operator/messages";
import { enqueue } from "../serial-queue";
import { dropUntilFirstUser, INBOUND_EXCLUDED_TOOLS } from "../handle-inbound-message";
import {
  findActiveChannel,
  isMessagingChannel,
  sendSavedMessageToCustomer,
  type MessagingChannelType,
} from "./deliver";
import { getHandoffRequest, isChatTakenOver } from "./store";
import { handoffTurnOptions, loadHandoffRuntime } from "./runtime";
import { loadLeadCapture } from "../leads/lead-capture";

/** Metadata key marking the agent's follow-up for one request. */
export const HANDOFF_FOLLOW_UP_KEY = "handoffRequestId" satisfies keyof MessageMetadata;

const FOLLOW_UP_HISTORY_LIMIT = 40;

export type FollowUpOutcome =
  | "sent"
  | "saved"
  | "not_needed"
  | "already_followed_up"
  | "taken_over"
  | "skipped";

/**
 * Queue the follow-up behind any run already going for this conversation, so
 * it never interleaves with a reply to the customer's own message.
 */
export async function enqueueHandoffFollowUp(requestId: string): Promise<boolean> {
  const request = await getHandoffRequest(requestId);
  if (!request) return false;
  enqueue(`chat:${request.chatId}`, async () => {
    try {
      await runHandoffFollowUp(requestId);
    } catch (cause) {
      console.error("[Handoff] follow-up failed", requestId, cause);
    }
  });
  return true;
}

async function alreadyFollowedUp(chatId: string, requestId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        sql`${messages.metadata} ->> ${HANDOFF_FOLLOW_UP_KEY} = ${requestId}`,
      ),
    )
    .limit(1);
  return !!row;
}

/** The text of the agent's follow-up for one request, once it has been saved. */
export async function findFollowUpText(
  chatId: string,
  requestId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        sql`${messages.metadata} ->> ${HANDOFF_FOLLOW_UP_KEY} = ${requestId}`,
      ),
    )
    .limit(1);
  return row?.content ?? null;
}

/**
 * Spec decision 5: once a colleague answers ("let the agent phrase it"), the
 * agent follows up right away, even if the customer has gone quiet. An
 * answer sent "as the person" is already in the transcript verbatim, so it
 * needs no follow-up.
 */
export async function runHandoffFollowUp(requestId: string): Promise<FollowUpOutcome> {
  const request = await getHandoffRequest(requestId);
  if (
    !request ||
    request.status !== "answered" ||
    request.replyMode !== "agent" ||
    !request.answer
  ) {
    return "not_needed";
  }
  if (await alreadyFollowedUp(request.chatId, request.id)) {
    return "already_followed_up";
  }

  const chat = await db.query.chats.findFirst({ where: eq(chats.id, request.chatId) });
  if (!chat?.agentId || chat.companyId !== request.companyId) return "skipped";

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, chat.agentId) });
  if (!agent || agent.kind === "operator") return "skipped";

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, chat.companyId),
  });
  if (!company) return "skipped";

  const scope = { id: agent.id, companyId: company.id };
  const handoff = await loadHandoffRuntime(scope, chat.id);
  if (handoff.paused) return "taken_over";

  // Who pays for this turn: the same budget the conversation's own turns use.
  const isMessaging = isMessagingChannel(chat.channelType);
  const channel = isMessagingChannel(chat.channelType)
    ? await findActiveChannel(agent.id, chat.channelType)
    : undefined;
  const budgetKey: [string, "channel" | "widget" | "user"] | null = isMessaging
    ? channel
      ? [channel.id, "channel"]
      : null
    : chat.channelType === "widget"
      ? [chat.visitorId ?? "unknown", "widget"]
      : chat.userId
        ? [chat.userId, "user"]
        : null;
  if (!budgetKey) return "skipped";
  const budget = await checkTokenBudget(budgetKey[0], budgetKey[1]);
  if (!budget.allowed) return "skipped";

  const handoffTurn = handoffTurnOptions(handoff, scope, company.name, () => chat.id);
  const enabledIntegrations = await db.query.integrations.findMany({
    where: eq(integrations.companyId, company.id),
  });
  const knowledgeEntries = await db.query.knowledgeBase.findMany({
    where: and(eq(knowledgeBase.agentId, agent.id), eq(knowledgeBase.status, "ready")),
  });
  const agentChannels = await db.query.channels.findMany({
    where: eq(channels.agentId, agent.id),
  });

  // The follow-up is driven by a stranger's conversation, like an inbound
  // run: no send tools, whatever the channel.
  const selected = selectTools(
    enabledIntegrations.filter((i) => i.status === "connected").map((i) => i.type),
    agent.id,
    agentChannels,
    {
      leadCapture: await loadLeadCapture(agent, () => chat.id),
      askHuman: handoffTurn.askHuman,
    },
  );
  const tools = Object.fromEntries(
    Object.entries(selected).filter(
      ([name]) => !(INBOUND_EXCLUDED_TOOLS as readonly string[]).includes(name),
    ),
  );

  const system = buildSystemPrompt({
    agent,
    company,
    knowledgeEntries,
    toolNames: Object.keys(tools),
    handoffSection: handoffTurn.handoffSection,
  });

  const history = dropUntilFirstUser(
    (await getChatHistory(chat.id)).slice(-FOLLOW_UP_HISTORY_LIMIT),
  );
  const modelMessages = await convertToModelMessages([
    ...dbMessagesToUIMessages(history),
    // Not stored and not from the customer: the turn needs to end on a user
    // message, and this is what the agent is reacting to.
    {
      id: `handoff-follow-up-${request.id}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `(Internal note, not from the customer.) Your colleague answered: "${request.answer}". Write your follow-up message to the customer now, in your own voice.`,
        },
      ],
    },
  ]);

  const { text, usage } = await generateText({
    model: getModel(agent.model),
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  });

  const totalTokens = usage.totalTokens ?? 0;
  if (totalTokens > 0) await recordTokenUsage(budgetKey[0], budgetKey[1], totalTokens);

  if (!text.trim()) return "skipped";
  if (await isChatTakenOver(chat.id)) return "taken_over";

  const messageId = await saveAssistantMessage(chat.id, text, {
    [HANDOFF_FOLLOW_UP_KEY]: request.id,
  });

  // Widget and test chat: the stored message is the delivery; the open widget
  // picks it up (S34). Messaging channels need an outbound send.
  if (!isMessaging) return "saved";

  const sent = await sendSavedMessageToCustomer({
    chatId: chat.id,
    channelType: chat.channelType as MessagingChannelType,
    visitorId: chat.visitorId,
    channel,
    messageId,
    text,
  });
  return sent ? "sent" : "saved";
}
