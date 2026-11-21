import { tool } from "ai";
import { z } from "zod";
import {
  postInstagramCommentReply,
  sendInstagramPrivateReply as sendPrivateReply,
} from "../integrations/instagram";
import {
  listAgentComments,
  loadAgentComment,
  markPrivateReplySent,
  markPublicReplied,
} from "./instagram-comment-store";

interface ToolFailure {
  success: false;
  id: null;
  error: string;
}

function failure(error: string): ToolFailure {
  return { success: false, id: null, error };
}

/**
 * Build the Instagram comment tools bound to one agent.
 * `agentId` lives in the closure rather than on an input schema, and every
 * lookup filters by it, so the model cannot read or answer another agent's
 * comments.
 */
export function makeInstagramCommentTools(agentId: string) {
  const listInstagramComments = tool({
    description:
      "List Instagram post and reel comments received by this agent, newest first. Comments arrive by webhook; this reads what has already been received.",
    inputSchema: z.object({
      mediaId: z
        .string()
        .optional()
        .describe("Only comments on this Instagram media id"),
      onlyUnanswered: z
        .boolean()
        .optional()
        .describe(
          "Only comments with neither a public nor a private reply sent"
        ),
      // Bounded because the model fills this in and the value reaches
      // `.limit()` unchanged: Postgres errors on a negative LIMIT, and
      // `execute` has no try/catch, so an unvalidated number ends the run
      // instead of returning something the model can work with. The ceiling
      // keeps a large value from swallowing the context window.
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of comments to return (1-100)"),
    }),
    execute: async ({ mediaId, onlyUnanswered, limit }) => {
      const comments = await listAgentComments(agentId, {
        mediaId,
        onlyUnanswered,
        limit,
      });
      return { comments, total: comments.length };
    },
  });

  const replyToInstagramComment = tool({
    description:
      "Post a publicly visible reply under an Instagram comment. Everyone who can see the post can see this reply.",
    inputSchema: z.object({
      commentId: z
        .string()
        .describe("Instagram comment id, from listInstagramComments"),
      content: z.string().describe("Reply text to post publicly"),
    }),
    execute: async ({ commentId, content }) => {
      const comment = await loadAgentComment(agentId, commentId);
      if (!comment) {
        return failure("This agent has no comment with that id");
      }
      if (!comment.credentials) {
        return failure(
          "The Instagram channel for this comment is missing accountId or accessToken"
        );
      }

      const result = await postInstagramCommentReply(
        comment.credentials,
        comment.igCommentId,
        content
      );

      // Recorded only after Instagram accepted it, so a rejected reply never
      // marks the comment answered.
      if (result.success && result.id) {
        await markPublicReplied(comment.id, result.id, content);
      }

      return result;
    },
  });

  const sendInstagramPrivateReply = tool({
    description:
      "Send a private direct message to the author of an Instagram comment. Instagram allows exactly one private reply per comment, within seven days — a comment that already has one cannot receive another.",
    inputSchema: z.object({
      commentId: z
        .string()
        .describe("Instagram comment id, from listInstagramComments"),
      content: z.string().describe("Direct message text"),
    }),
    execute: async ({ commentId, content }) => {
      const comment = await loadAgentComment(agentId, commentId);
      if (!comment) {
        return failure("This agent has no comment with that id");
      }
      if (comment.privateReplySentAt) {
        return failure(
          "A private reply was already sent for this comment; Instagram allows only one"
        );
      }
      if (!comment.credentials) {
        return failure(
          "The Instagram channel for this comment is missing accountId or accessToken"
        );
      }

      const result = await sendPrivateReply(
        comment.credentials,
        comment.igCommentId,
        content
      );

      if (result.success && result.id) {
        await markPrivateReplySent(comment.id, result.id);
      }

      return result;
    },
  });

  return {
    listInstagramComments,
    replyToInstagramComment,
    sendInstagramPrivateReply,
  };
}
