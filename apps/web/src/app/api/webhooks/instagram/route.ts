import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, channels, instagramComments } from "@relay/db";
import {
  parseCommentEvents,
  parseDirectMessageEvents,
} from "@/lib/instagram-webhook";
import {
  bodyTooLarge,
  challengeResponse,
  verifyMetaSignature,
} from "@/lib/meta-webhook";
import {
  findOrCreateChat,
  saveInboundMessage,
} from "@/lib/inbound-conversation";
import {
  notifyWorkerComment,
  notifyWorkerInbound,
} from "@/lib/worker-proxy";
import { RATE_LIMIT_SURFACES, enforceSurface } from "@/lib/rate-limit";

// `db` comes from "@/db" and the tables from "@relay/db" on purpose. The web
// test setup mocks "@/db" as `{ db: mockDb }` only, so a table imported from
// there would be undefined under test; the "@relay/db" mock spreads the real
// module and keeps the table definitions intact.

export async function GET(request: Request) {
  return challengeResponse(request, process.env.META_WEBHOOK_VERIFY_TOKEN);
}

/**
 * Persist incoming post and reel comments and direct messages.
 *
 * Comments and direct messages both start an agent run when the channel has
 * the matching flag on: `autoCommentReply` for a public comment reply,
 * `autoReply` for a direct message. Everything is persisted either way.
 *
 * Status codes drive Meta's retries: 401 for a signature we reject, 200 for
 * anything a retry cannot fix, and 500 only for a transient failure where a
 * retry is what we want.
 */
export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[InstagramWebhook] META_APP_SECRET is not configured");
    return new Response("Not configured", { status: 500 });
  }

  // Checked before the read, because the read is the cost: this route is
  // public and the signature can only be verified once the whole body is in
  // memory.
  if (bodyTooLarge(request.headers.get("content-length"))) {
    console.warn("[InstagramWebhook] refused an oversized body");
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

  const events = parseCommentEvents(rawBody);
  const directMessages = parseDirectMessageEvents(rawBody);

  try {
    for (const event of events) {
      const channel = await db.query.channels.findFirst({
        where: and(
          eq(channels.type, "instagram"),
          eq(channels.status, "active"),
          sql`${channels.config}->>'accountId' = ${event.igAccountId}`
        ),
      });

      if (!channel) {
        console.warn(
          "[InstagramWebhook] no active channel for account",
          event.igAccountId
        );
        continue;
      }

      const [inserted] = await db
        .insert(instagramComments)
        .values({
          channelId: channel.id,
          agentId: channel.agentId,
          igCommentId: event.igCommentId,
          igMediaId: event.igMediaId,
          parentIgCommentId: event.parentIgCommentId,
          fromIgUserId: event.fromIgUserId,
          fromUsername: event.fromUsername,
          content: event.content,
          commentedAt: event.commentedAt,
          raw: event.raw,
        })
        .onConflictDoNothing({ target: instagramComments.igCommentId })
        .returning({ id: instagramComments.id });

      // No row means the unique index dropped it: a redelivery of a comment we
      // already stored, and possibly already answered. Answering again would
      // put a second public reply under it.
      if (!inserted) continue;

      // Off by default, and separate from `autoReply`, because this one writes
      // on a public timeline.
      if (channel.config?.autoCommentReply !== true) continue;

      // Channels carry no companyId; the agent does. A missing agent only
      // means platform defaults apply.
      const commentAgent = await db.query.agents.findFirst({
        where: eq(agents.id, channel.agentId),
      });
      const commentLimited = await enforceSurface(
        RATE_LIMIT_SURFACES.instagramComment({
          channelId: channel.id,
          authorId: event.fromIgUserId ?? "unknown",
          companyId: commentAgent?.companyId,
        }),
      );
      if (!commentLimited.ok) {
        console.warn("[InstagramWebhook] comment auto-reply rate limited", {
          channelId: channel.id,
          policy: commentLimited.denial.policy,
        });
        continue;
      }

      // notifyWorkerComment returns false rather than throwing on failure, and
      // its result is ignored on purpose: a 500 here would make Meta retry,
      // but the comment is already stored, so the retry would be dropped by
      // the redelivery guard above and we'd never get a second chance to reply.
      await notifyWorkerComment({
        channelId: channel.id,
        commentId: inserted.id,
      });
    }

    for (const event of directMessages) {
      const channel = await db.query.channels.findFirst({
        where: and(
          eq(channels.type, "instagram"),
          eq(channels.status, "active"),
          sql`${channels.config}->>'accountId' = ${event.igAccountId}`
        ),
      });

      if (!channel) {
        console.warn(
          "[InstagramWebhook] no active channel for account",
          event.igAccountId
        );
        continue;
      }

      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, channel.agentId),
      });

      if (!agent) {
        console.warn("[InstagramWebhook] channel has no agent", channel.id);
        continue;
      }

      // A DM payload carries no username, unlike a comment's `from.username`,
      // so the conversation is titled with the sender id.
      const chatId = await findOrCreateChat({
        agentId: channel.agentId,
        companyId: agent.companyId,
        platform: "instagram",
        senderId: event.fromIgUserId,
        title: event.fromIgUserId,
      });

      const stored = await saveInboundMessage({
        chatId,
        content: event.content,
        platformMessageId: event.mid,
        senderName: null,
      });

      if (!stored) continue;
      if (channel.config?.autoReply !== true) continue;

      const dmLimited = await enforceSurface(
        RATE_LIMIT_SURFACES.inboundMessage({
          channelId: channel.id,
          senderId: event.fromIgUserId,
          companyId: agent.companyId,
        }),
      );
      if (!dmLimited.ok) {
        console.warn("[InstagramWebhook] auto-reply rate limited", {
          channelId: channel.id,
          policy: dmLimited.denial.policy,
        });
        continue;
      }

      await notifyWorkerInbound({
        platform: "instagram",
        chatId,
        channelId: channel.id,
      });
    }
  } catch (cause) {
    // Transient: let Meta retry rather than dropping the comment.
    console.error("[InstagramWebhook] failed to store comments", cause);
    return new Response("Storage failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
