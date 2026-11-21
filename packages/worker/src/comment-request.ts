import { findCommentMedia } from "./ai/instagram-comment-store";
import {
  enqueueCommentRun,
  type CommentRunRequest,
} from "./handle-instagram-comment";

/**
 * Validate an `/internal/comment` body. The caller is our own web app behind a
 * shared secret, so this guards against a malformed request rather than a
 * hostile one — but a bad commentId would start a run against nothing.
 */
export function parseCommentRequest(body: unknown): CommentRunRequest | null {
  if (!body || typeof body !== "object") return null;

  const { channelId, commentId } = body as Record<string, unknown>;

  if (typeof channelId !== "string" || channelId.length === 0) return null;
  if (typeof commentId !== "string" || commentId.length === 0) return null;

  return { channelId, commentId };
}

/**
 * Accept a comment for answering: validate, resolve the queue key, enqueue.
 *
 * The queue is keyed by the comment's post, which the body does not carry, so
 * one read happens here before the 202. Anything this reads is stale by the
 * time a queued run reaches the front, so the run reloads the row itself.
 */
export async function handleCommentRequest(
  body: unknown
): Promise<{ status: number; text: string }> {
  const request = parseCommentRequest(body);
  if (!request) {
    return { status: 400, text: "Invalid comment request" };
  }

  const igMediaId = await findCommentMedia(request.commentId, request.channelId);
  if (!igMediaId) {
    return { status: 404, text: "No such comment" };
  }

  enqueueCommentRun(request, igMediaId);
  return { status: 202, text: "Accepted" };
}
