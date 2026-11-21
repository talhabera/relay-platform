import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, channels } from "@relay/db";
import {
  bodyTooLarge,
  challengeResponse,
  verifyMetaSignature,
} from "@/lib/meta-webhook";
import {
  hasWhatsAppGroupEvents,
  parseWhatsAppButtonReplies,
  parseWhatsAppMessageEvents,
  parseWhatsAppStatusEvents,
} from "@/lib/whatsapp-webhook";
import {
  findOrCreateChat,
  saveInboundMessage,
  updateMessageStatus,
} from "@/lib/inbound-conversation";
import {
  forwardHandoffRecipientReply,
  forwardWhatsAppGroupWebhook,
  notifyWorkerInbound,
} from "@/lib/worker-proxy";
import { updateHandoffNotificationStatus } from "@/lib/handoff/notification-status";

/** Payload prefix of the handoff recipient's Confirm button (worker S35). */
const HANDOFF_CONFIRM_PREFIX = "handoff_confirm:";
import { RATE_LIMIT_SURFACES, enforceSurface } from "@/lib/rate-limit";

// `db` comes from "@/db" and the tables from "@relay/db" on purpose. The web
// test setup mocks "@/db" as `{ db: mockDb }` only, so a table imported from
// there would be undefined under test.

/** Meta's subscription handshake, answered only for our verify token. */
export async function GET(request: Request) {
  return challengeResponse(request, process.env.META_WEBHOOK_VERIFY_TOKEN);
}

/**
 * Persist inbound WhatsApp messages and, when the channel has auto-reply on,
 * ask the worker to answer them.
 *
 * Status codes drive Meta's retries: 401 for a signature we reject, 200 for
 * anything a retry cannot fix, and 500 only for a transient failure where a
 * retry is what we want.
 */
export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[WhatsAppWebhook] META_APP_SECRET is not configured");
    return new Response("Not configured", { status: 500 });
  }

  // Checked before the read, because the read is the cost: this route is
  // public and the signature can only be verified once the whole body is in
  // memory.
  if (bodyTooLarge(request.headers.get("content-length"))) {
    console.warn("[WhatsAppWebhook] refused an oversized body");
    return new Response("Payload too large", { status: 413 });
  }

  // The signature covers the exact bytes received, so read the body as text
  // before parsing. Calling request.json() first would lose them.
  const rawBody = await request.text();

  if (
    !verifyMetaSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret
    )
  ) {
    return new Response("Invalid signature", { status: 401 });
  }

  // WhatsApp Groups traffic (handoff Team chat) goes to the worker as the
  // verified body. The parsers below skip group messages, so none of it
  // opens a customer chat.
  if (hasWhatsAppGroupEvents(rawBody)) {
    const forwarded = await forwardWhatsAppGroupWebhook(rawBody);
    if (!forwarded) console.warn("[WhatsAppWebhook] group webhook not forwarded");
  }

  const events = parseWhatsAppMessageEvents(rawBody);
  const statusEvents = parseWhatsAppStatusEvents(rawBody);
  const buttonReplies = parseWhatsAppButtonReplies(rawBody);

  // A handoff recipient tapping Confirm. Not a customer message: nothing is
  // stored, and the worker decides whether the tap counts (right sender, the
  // number on file). Never fails the webhook.
  for (const reply of buttonReplies) {
    if (!reply.payload.startsWith(HANDOFF_CONFIRM_PREFIX)) continue;
    const forwarded = await forwardHandoffRecipientReply({
      phoneNumberId: reply.phoneNumberId,
      fromWaId: reply.fromWaId,
      payload: reply.payload,
    });
    if (!forwarded) {
      console.warn("[WhatsAppWebhook] recipient reply not forwarded", reply.waMessageId);
    }
  }

  try {
    for (const event of events) {
      const channel = await db.query.channels.findFirst({
        where: and(
          eq(channels.type, "whatsapp"),
          eq(channels.status, "active"),
          sql`${channels.config}->>'phoneNumberId' = ${event.phoneNumberId}`
        ),
      });

      if (!channel) {
        console.warn(
          "[WhatsAppWebhook] no active channel for phone number",
          event.phoneNumberId
        );
        continue;
      }

      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, channel.agentId),
      });

      if (!agent) {
        console.warn(
          "[WhatsAppWebhook] channel has no agent",
          channel.id
        );
        continue;
      }

      const chatId = await findOrCreateChat({
        agentId: channel.agentId,
        companyId: agent.companyId,
        platform: "whatsapp",
        senderId: event.fromWaId,
        title: event.profileName ?? event.fromWaId,
      });

      const stored = await saveInboundMessage({
        chatId,
        content: event.content,
        platformMessageId: event.waMessageId,
        senderName: event.profileName,
        referral: event.referral,
      });

      // A redelivery of a message we already answered. Answering again would
      // send the customer a second reply.
      if (!stored) continue;

      // Off by default, so connecting a live business number cannot start
      // replying to customers before someone turns it on.
      if (channel.config?.autoReply !== true) continue;

      // The message is stored either way; over the limit only the auto-reply
      // is skipped, so one sender cannot run up the channel's Anthropic spend.
      const limited = await enforceSurface(
        RATE_LIMIT_SURFACES.inboundMessage({
          channelId: channel.id,
          senderId: event.fromWaId,
          companyId: agent.companyId,
        }),
      );
      if (!limited.ok) {
        console.warn("[WhatsAppWebhook] auto-reply rate limited", {
          channelId: channel.id,
          policy: limited.denial.policy,
        });
        continue;
      }

      await notifyWorkerInbound({
        platform: "whatsapp",
        chatId,
        channelId: channel.id,
      });
    }

    // A status names its message by wamid and nothing else, and the signature
    // proves only that Meta sent it. Resolve the channel the same way the
    // message path does, so a status can only touch a conversation belonging
    // to the number it was delivered for.
    for (const event of statusEvents) {
      const channel = await db.query.channels.findFirst({
        where: and(
          eq(channels.type, "whatsapp"),
          eq(channels.status, "active"),
          sql`${channels.config}->>'phoneNumberId' = ${event.phoneNumberId}`
        ),
      });

      if (!channel) {
        console.warn(
          "[WhatsAppWebhook] no active channel for status phone number",
          event.phoneNumberId
        );
        continue;
      }

      const matchedMessage = await updateMessageStatus({
        waMessageId: event.waMessageId,
        agentId: channel.agentId,
        status: event.status,
        statusAt: event.statusAt,
        error: event.error,
      });
      if (matchedMessage) continue;

      // Not a conversation message: it may be a handoff staff notification,
      // sent from any of the company's numbers. A wamid matching neither is
      // ignored.
      const owner = await db.query.agents.findFirst({
        where: eq(agents.id, channel.agentId),
      });
      if (!owner) continue;

      await updateHandoffNotificationStatus({
        waMessageId: event.waMessageId,
        companyId: owner.companyId,
        status: event.status,
        statusAt: event.statusAt,
        error: event.error,
      });
    }
  } catch (cause) {
    // Transient: let Meta retry rather than dropping the message.
    console.error("[WhatsAppWebhook] failed to store messages", cause);
    return new Response("Storage failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
