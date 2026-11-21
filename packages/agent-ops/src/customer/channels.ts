import { eq } from "drizzle-orm";
import { channels, db } from "@relay/db";
import { requireAgentAccess } from "../auth/access";
import { maskChannelConfig } from "../shared/secrets";
import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "./schemas";

function assertCustomerAgent(
  agent: { kind: string },
  action: "accessed" | "updated" | "deleted",
) {
  if (agent.kind !== "customer") {
    const messages = {
      accessed: "Only customer agents in this company can be accessed",
      updated: "Only customer agents in this company can be updated",
      deleted: "Only customer agents in this company can be deleted",
    } as const;
    throw new Error(messages[action]);
  }
}

async function requireCustomerChannel(userId: string, channelId: string) {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });
  if (!channel) {
    throw new Error("Channel not found");
  }

  const { agent } = await requireAgentAccess(userId, channel.agentId);
  assertCustomerAgent(agent, "accessed");

  return { channel, agent };
}

export async function listChannels(userId: string, agentId: string) {
  const { agent } = await requireAgentAccess(userId, agentId);
  assertCustomerAgent(agent, "accessed");

  const rows = await db.query.channels.findMany({
    where: eq(channels.agentId, agentId),
  });

  return {
    channels: rows.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      agentId: channel.agentId,
      status: channel.status,
      config: maskChannelConfig(channel.config),
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    })),
  };
}

/**
 * A WhatsApp phone number id and an Instagram account id are how an inbound
 * Meta delivery finds its channel, so the database keeps each of them unique.
 * Two channels claiming one key is not a duplicate row to shrug at: it is one
 * company receiving another company's conversations. Turn the constraint into
 * something the person at the form can act on, and leave every other database
 * error alone.
 */
function rethrowRoutingKeyConflict(cause: unknown): never {
  const error = cause as { code?: string; constraint_name?: string };

  if (error?.code === "23505") {
    if (error.constraint_name === "channels_whatsapp_phone_number_uidx") {
      throw new Error(
        "That WhatsApp number is already connected to another channel",
      );
    }
    if (error.constraint_name === "channels_instagram_account_uidx") {
      throw new Error(
        "That Instagram account is already connected to another channel",
      );
    }
  }

  throw cause;
}

export async function createChannel(userId: string, input: CreateChannelInput) {
  const parsed = createChannelSchema.parse(input);

  const { agent } = await requireAgentAccess(userId, parsed.agentId);
  assertCustomerAgent(agent, "accessed");

  const [channel] = await db
    .insert(channels)
    .values({
      name: parsed.name,
      type: parsed.type,
      agentId: parsed.agentId,
      config: parsed.config ?? {},
    })
    .returning({ id: channels.id })
    .catch(rethrowRoutingKeyConflict);

  return { id: channel.id };
}

export async function updateChannel(
  userId: string,
  channelId: string,
  input: UpdateChannelInput,
) {
  const parsed = updateChannelSchema.parse(input);
  await requireCustomerChannel(userId, channelId);

  await db
    .update(channels)
    .set({
      ...parsed,
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId))
    .catch(rethrowRoutingKeyConflict);

  return { id: channelId };
}

/** The channel flags that can be flipped on their own. */
const CHANNEL_FLAGS = ["autoReply", "autoCommentReply"] as const;

export type ChannelFlag = (typeof CHANNEL_FLAGS)[number];

/**
 * Turn one auto-reply flag on or off for a channel.
 *
 * Deliberately not a call into `updateChannel`: that one does
 * `.set({ ...parsed })`, and `config` is a whole-jsonb replace, so passing
 * `{ config: { autoReply: true } }` would wipe `phoneNumberId` and
 * `accessToken` and silently disconnect the channel. Reading the row and
 * merging here also keeps the access token from round-tripping through the
 * client, which only ever sees a masked config.
 *
 * `flag` is typed as a union, but `setChannelFlag` is reachable from a
 * `"use server"` action, so by the time it runs here `flag` is
 * attacker-supplied JSON with the type checker already erased — the union
 * catches nothing at runtime. What actually stops an arbitrary key merging
 * into `config` is the `CHANNEL_FLAGS.includes` guard below.
 */
export async function setChannelFlag(
  userId: string,
  channelId: string,
  flag: ChannelFlag,
  enabled: boolean,
) {
  if (!CHANNEL_FLAGS.includes(flag as ChannelFlag) || typeof enabled !== "boolean") {
    throw new Error("Unknown channel flag");
  }

  const { channel } = await requireCustomerChannel(userId, channelId);

  await db
    .update(channels)
    .set({
      config: { ...(channel.config ?? {}), [flag]: enabled },
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId));

  return { id: channelId };
}

export async function deleteChannel(userId: string, channelId: string) {
  await requireCustomerChannel(userId, channelId);

  await db.delete(channels).where(eq(channels.id, channelId));

  return { id: channelId };
}
