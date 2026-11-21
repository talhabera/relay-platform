import { and, eq, sql } from "drizzle-orm";
import { channels, chats, companies, db, messages } from "@relay/db";
import {
  sendMessage,
  type InstagramCredentials,
  type MessagePlatform,
  type MessengerCredentials,
  type WhatsAppCredentials,
} from "../integrations/messaging";
import { credentialsFor } from "../handle-inbound-message";
import { enqueue } from "../serial-queue";

/** Chat channel types whose replies need an outbound platform send. */
export type MessagingChannelType = "whatsapp" | "instagram" | "messenger";

export function isMessagingChannel(
  channelType: string | null | undefined,
): channelType is MessagingChannelType {
  return (
    channelType === "whatsapp" || channelType === "instagram" || channelType === "messenger"
  );
}

const PLATFORM_FOR: Record<MessagingChannelType, MessagePlatform> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "facebook",
};

function sendCredentials(
  channelType: MessagingChannelType,
  config: { phoneNumberId?: string; accountId?: string; pageId?: string; accessToken?: string },
): WhatsAppCredentials | InstagramCredentials | MessengerCredentials | null {
  if (channelType === "messenger") {
    return config.pageId && config.accessToken
      ? { pageId: config.pageId, accessToken: config.accessToken }
      : null;
  }
  return credentialsFor(channelType, config);
}

/**
 * Spec decision 9: a person's message on a messaging channel is prefixed with
 * their first name and the company, "Markus (Acme): ". The widget shows a
 * person marker instead, so the stored text stays unprefixed.
 */
export function personPrefix(displayName: string, companyName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0] || displayName.trim();
  return `${firstName} (${companyName}): `;
}

export type ChannelRow = typeof channels.$inferSelect;

/** The agent's active channel of this type, which holds the send credentials. */
export async function findActiveChannel(
  agentId: string,
  type: MessagingChannelType,
): Promise<ChannelRow | undefined> {
  return db.query.channels.findFirst({
    where: and(
      eq(channels.agentId, agentId),
      eq(channels.type, type),
      eq(channels.status, "active"),
    ),
  });
}

/**
 * Send an already-saved assistant message out through WhatsApp, Instagram or
 * Messenger and record the platform id on it. Widget and test chat need no send: the
 * stored message is the delivery. Returns whether the platform accepted it.
 */
export async function sendSavedMessageToCustomer(input: {
  chatId: string;
  channelType: MessagingChannelType;
  visitorId: string | null;
  channel: ChannelRow | undefined;
  messageId: string;
  text: string;
}): Promise<boolean> {
  const credentials = input.channel
    ? sendCredentials(input.channelType, input.channel.config ?? {})
    : null;
  if (!credentials || !input.visitorId) {
    console.error("[Handoff] no way to send to the customer", input.chatId);
    return false;
  }
  const result = await sendMessage(
    PLATFORM_FOR[input.channelType],
    input.visitorId,
    input.text,
    credentials,
  );
  if (!result.success || !result.messageId) {
    console.error("[Handoff] send to the customer failed", result.error);
    return false;
  }
  await db
    .update(messages)
    .set({
      metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify({
        platformMessageId: result.messageId,
      })}::jsonb`,
    })
    .where(eq(messages.id, input.messageId));
  return true;
}

export type HumanDeliveryOutcome =
  | "sent"
  | "stored"
  | "already_sent"
  | "failed"
  | "not_found";

/**
 * Deliver a message a person wrote through human handoff (quick-link answer
 * "as the person", or a takeover message). Web stores the row; this sends it.
 * Widget and test chat need no send: the stored row is the delivery, picked
 * up by the widget's event stream or its missed-message fetch. Messaging
 * channels get the "Markus (Acme): " prefix. A row that already carries a
 * platform id is never sent twice.
 */
export async function deliverHumanMessage(
  messageId: string,
): Promise<HumanDeliveryOutcome> {
  const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!message || message.author !== "human" || message.role !== "assistant") {
    return "not_found";
  }
  if (message.metadata?.platformMessageId) return "already_sent";

  const chat = await db.query.chats.findFirst({ where: eq(chats.id, message.chatId) });
  if (!chat) return "not_found";
  if (!isMessagingChannel(chat.channelType)) return "stored";

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, chat.companyId),
  });
  if (!company) return "not_found";

  const channel = chat.agentId
    ? await findActiveChannel(chat.agentId, chat.channelType)
    : undefined;
  const text =
    personPrefix(message.authorDisplayName ?? company.name, company.name) + message.content;
  const sent = await sendSavedMessageToCustomer({
    chatId: chat.id,
    channelType: chat.channelType,
    visitorId: chat.visitorId,
    channel,
    messageId: message.id,
    text,
  });
  return sent ? "sent" : "failed";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Queue a person's message for delivery behind anything already running for
 * the conversation, so a takeover's messages leave in the order written.
 * Returns false when there is no such message.
 */
export async function enqueueHumanMessageDelivery(messageId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(messageId)) return false;
  const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!message || message.author !== "human") return false;
  enqueue(`chat:${message.chatId}`, async () => {
    try {
      const outcome = await deliverHumanMessage(messageId);
      if (outcome === "failed") console.error("[Handoff] human message not delivered", messageId);
    } catch (cause) {
      console.error("[Handoff] human message delivery failed", messageId, cause);
    }
  });
  return true;
}
