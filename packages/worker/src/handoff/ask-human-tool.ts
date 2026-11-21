import { tool } from "ai";
import { z } from "zod";
import { notifyHandoffRecipient, type HandoffNotifier } from "./notify";
import { openOrAppendHandoffRequest } from "./store";

export interface AskHumanContext {
  agentId: string;
  companyId: string;
  /** Read when the tool runs: the widget creates its chat after the tools are built. */
  getChatId: () => string | null;
  /** "Customer sees while waiting", resolved to the default copy when unset. */
  waitingText: string;
  notify?: HandoffNotifier;
}

/**
 * Same limits as `askHumanSchema` in `apps/web/src/lib/handoff/validators.ts`.
 * No chat, company or agent id: the tenant comes from the closure, so the
 * model cannot open a request on someone else's conversation.
 */
export const askHumanInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Which handoff rule applies and why, in one sentence"),
  confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("How confident you are in answering yourself, 0-100"),
  question: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("The exact question for your colleague"),
  suggestedReplies: z
    .array(z.string().trim().min(1).max(500))
    .max(5)
    .optional()
    .describe("Up to 5 short answers your colleague could pick from"),
});

export function makeAskHumanTool(ctx: AskHumanContext) {
  const notify = ctx.notify ?? notifyHandoffRecipient;

  return tool({
    description:
      "Ask a colleague at the company when a handoff rule applies. One request stays open per conversation; asking again adds the question to it. The answer arrives later, so keep helping meanwhile and never guess it.",
    inputSchema: askHumanInputSchema,
    execute: async (input) => {
      const chatId = ctx.getChatId();
      if (!chatId) {
        return {
          success: false as const,
          error: "There is no conversation to attach this request to yet",
        };
      }

      try {
        const result = await openOrAppendHandoffRequest(
          { id: ctx.agentId, companyId: ctx.companyId },
          chatId,
          {
            reason: input.reason,
            confidence: input.confidence ?? null,
            question: input.question,
            suggestedReplies: input.suggestedReplies ?? [],
          },
        );

        // Appending never notifies a second time (spec decision 4).
        if (result.kind === "opened") {
          try {
            await notify({ request: result.request, token: result.token });
          } catch (error) {
            console.error("[ask_human] notification failed", result.request.id, error);
          }
        }

        return {
          success: true as const,
          status: result.kind === "opened" ? ("asked" as const) : ("added_to_open_request" as const),
          tellCustomer: ctx.waitingText,
          instruction:
            "Tell the customer you are checking with a colleague, keep helping with anything else, and do not guess the answer.",
        };
      } catch (error) {
        console.error("[ask_human] could not open the request", error);
        return { success: false as const, error: "The colleague could not be reached" };
      }
    },
  });
}
