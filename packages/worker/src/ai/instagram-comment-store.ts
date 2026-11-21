import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { channels, db, instagramComments } from "@relay/db";
import type { InstagramCredentials } from "../integrations/instagram";

/** A comment as the model sees it. Never carries credentials. */
export interface AgentComment {
  igCommentId: string;
  igMediaId: string;
  parentIgCommentId: string | null;
  fromUsername: string | null;
  content: string;
  commentedAt: Date;
  publicRepliedAt: Date | null;
  privateReplySentAt: Date | null;
}

/** A comment plus the credentials needed to answer it. */
export interface LoadedComment {
  id: string;
  igCommentId: string;
  publicRepliedAt: Date | null;
  privateReplySentAt: Date | null;
  credentials: InstagramCredentials | null;
}

const DEFAULT_LIMIT = 25;

/**
 * Derive Graph API credentials from a channel's config, or null if either
 * half is missing. Shared by every reader that hands a comment back with the
 * credentials needed to answer it, so how credentials are derived from a
 * channel only has to change in one place.
 */
async function resolveChannelCredentials(
  channelId: string
): Promise<InstagramCredentials | null> {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });

  const accountId = channel?.config?.accountId;
  const accessToken = channel?.config?.accessToken;

  return accountId && accessToken ? { accountId, accessToken } : null;
}

/**
 * List an agent's comments, newest first.
 * `onlyUnanswered` means neither a public nor a private reply has gone out.
 */
export async function listAgentComments(
  agentId: string,
  options: { mediaId?: string; onlyUnanswered?: boolean; limit?: number } = {}
): Promise<AgentComment[]> {
  const filters = [eq(instagramComments.agentId, agentId)];

  if (options.mediaId) {
    filters.push(eq(instagramComments.igMediaId, options.mediaId));
  }
  if (options.onlyUnanswered) {
    filters.push(isNull(instagramComments.publicRepliedAt));
    filters.push(isNull(instagramComments.privateReplySentAt));
  }

  const rows = await db
    .select({
      igCommentId: instagramComments.igCommentId,
      igMediaId: instagramComments.igMediaId,
      parentIgCommentId: instagramComments.parentIgCommentId,
      fromUsername: instagramComments.fromUsername,
      content: instagramComments.content,
      commentedAt: instagramComments.commentedAt,
      publicRepliedAt: instagramComments.publicRepliedAt,
      privateReplySentAt: instagramComments.privateReplySentAt,
    })
    .from(instagramComments)
    .where(and(...filters))
    .orderBy(desc(instagramComments.commentedAt))
    .limit(options.limit ?? DEFAULT_LIMIT);

  return rows;
}

/**
 * Load one comment belonging to this agent, with its channel credentials.
 * The `agentId` filter is the ownership boundary: a comment on another
 * agent's channel resolves to null, so the model cannot act on it.
 */
export async function loadAgentComment(
  agentId: string,
  igCommentId: string
): Promise<LoadedComment | null> {
  const comment = await db.query.instagramComments.findFirst({
    where: and(
      eq(instagramComments.agentId, agentId),
      eq(instagramComments.igCommentId, igCommentId)
    ),
  });

  if (!comment) return null;

  return {
    id: comment.id,
    igCommentId: comment.igCommentId,
    publicRepliedAt: comment.publicRepliedAt,
    privateReplySentAt: comment.privateReplySentAt,
    credentials: await resolveChannelCredentials(comment.channelId),
  };
}

/** Record a public reply. Called only after the Graph API accepted it. */
export async function markPublicReplied(
  id: string,
  publicReplyIgId: string,
  publicReplyText: string
): Promise<void> {
  await db
    .update(instagramComments)
    .set({ publicReplyIgId, publicReplyText, publicRepliedAt: new Date() })
    .where(eq(instagramComments.id, id));
}

/** Record a private reply. Called only after the Graph API accepted it. */
export async function markPrivateReplySent(
  id: string,
  privateReplyIgId: string
): Promise<void> {
  await db
    .update(instagramComments)
    .set({ privateReplyIgId, privateReplySentAt: new Date() })
    .where(eq(instagramComments.id, id));
}

/** Everything the auto-reply run needs about one comment, by row id. */
export interface CommentRun {
  id: string;
  agentId: string;
  channelId: string;
  igCommentId: string;
  igMediaId: string;
  fromUsername: string | null;
  content: string;
  publicRepliedAt: Date | null;
  credentials: InstagramCredentials | null;
}

/**
 * Load a comment by row id, with its channel credentials.
 *
 * Unlike `loadAgentComment` this takes no `agentId`: the caller is our own
 * webhook bridge, not the model, and the agent is read off the row rather than
 * asserted against it.
 */
export async function loadCommentRun(id: string): Promise<CommentRun | null> {
  const comment = await db.query.instagramComments.findFirst({
    where: eq(instagramComments.id, id),
  });

  if (!comment) return null;

  return {
    id: comment.id,
    agentId: comment.agentId,
    channelId: comment.channelId,
    igCommentId: comment.igCommentId,
    igMediaId: comment.igMediaId,
    fromUsername: comment.fromUsername,
    content: comment.content,
    publicRepliedAt: comment.publicRepliedAt,
    credentials: await resolveChannelCredentials(comment.channelId),
  };
}

/**
 * The media a comment belongs to, scoped by channel.
 *
 * The queue key is derived from the media, so the endpoint needs this before
 * it can enqueue. Scoping by channel means a body naming another channel's
 * comment resolves to null and starts no run.
 */
export async function findCommentMedia(
  id: string,
  channelId: string
): Promise<string | null> {
  const row = await db.query.instagramComments.findFirst({
    where: and(
      eq(instagramComments.id, id),
      eq(instagramComments.channelId, channelId)
    ),
    columns: { igMediaId: true },
  });

  return row?.igMediaId ?? null;
}

/** One earlier comment on the same post, as the prompt shows it. */
export interface MediaComment {
  fromUsername: string | null;
  content: string;
  publicReplyText: string | null;
}

const CONTEXT_DEFAULT_LIMIT = 10;

/**
 * Recent comments on one post for one agent, oldest first, each with the text
 * of the public reply we sent if we sent one.
 *
 * The query orders newest-first so the limit keeps the most recent comments,
 * then the result is reversed: a prompt reads in chronological order.
 */
export async function listMediaContext(
  agentId: string,
  igMediaId: string,
  excludeId: string,
  limit: number = CONTEXT_DEFAULT_LIMIT
): Promise<MediaComment[]> {
  const rows = await db
    .select({
      fromUsername: instagramComments.fromUsername,
      content: instagramComments.content,
      publicReplyText: instagramComments.publicReplyText,
    })
    .from(instagramComments)
    .where(
      and(
        eq(instagramComments.agentId, agentId),
        eq(instagramComments.igMediaId, igMediaId),
        ne(instagramComments.id, excludeId)
      )
    )
    .orderBy(desc(instagramComments.commentedAt))
    .limit(limit);

  return rows.reverse();
}
