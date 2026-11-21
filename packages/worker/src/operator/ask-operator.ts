import { tool } from "ai";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AGENT_QUESTION_MAX_SUGGESTIONS,
  AGENT_QUESTION_MIN_SUGGESTIONS,
  OPEN_CHECKPOINT_STATUSES,
  agentQuestions,
  chats,
  checkpoints,
  db,
  deriveSessionStatus,
} from "@relay/db";

// Agent question (checkpoints spec decisions 8-12). The operator agent asks a
// person mid-task and ends its turn; the session or Schedule run stays blocked
// until someone who can steer answers. Not a checkpoint: nothing executes.

export const ASK_OPERATOR_TOOL = "ask_operator";

/** Tool result status that pauses a Schedule run (`awaiting_input`). */
export const AWAITING_ANSWER = "awaiting_answer";

/**
 * No company, agent or parent id: the tenant comes from the closure, so the
 * model cannot open a question on someone else's session or run.
 */
export const askOperatorInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("The exact question for the person, in one or two sentences"),
  suggestedAnswers: z
    .array(z.string().trim().min(1).max(200))
    .min(AGENT_QUESTION_MIN_SUGGESTIONS)
    .max(AGENT_QUESTION_MAX_SUGGESTIONS)
    .optional()
    .describe(
      "2-4 short answers the person can pick with one tap. Omit when the answer must be typed.",
    ),
});

export type AskOperatorInput = z.infer<typeof askOperatorInputSchema>;

export type AskOperatorParent = { chatId: string } | { cronRunId: string };

export type AskOperatorResult =
  | {
      status: typeof AWAITING_ANSWER;
      kind: "agent_question";
      toolName: typeof ASK_OPERATOR_TOOL;
      questionId: string;
      question: string;
      suggestedAnswers: string[];
      message: string;
    }
  | { error: string };

export async function askOperator(opts: {
  companyId: string;
  agentId: string;
  parent: AskOperatorParent;
  input: AskOperatorInput;
}): Promise<AskOperatorResult> {
  const parsed = askOperatorInputSchema.safeParse(opts.input);
  if (!parsed.success) {
    return {
      error: `Invalid question: ask in plain text with 2-4 suggested answers or none`,
    };
  }
  const { question } = parsed.data;
  const suggestedAnswers = parsed.data.suggestedAnswers ?? [];
  const chatId = "chatId" in opts.parent ? opts.parent.chatId : null;
  const cronRunId = "cronRunId" in opts.parent ? opts.parent.cronRunId : null;

  const [row] = await db
    .insert(agentQuestions)
    .values({
      companyId: opts.companyId,
      agentId: opts.agentId,
      chatId,
      cronRunId,
      question,
      suggestedAnswers,
      status: "open",
    })
    .returning({ id: agentQuestions.id });

  if (chatId) {
    // An open question means the session waits on a person.
    await db
      .update(chats)
      .set({
        status: deriveSessionStatus({
          running: false,
          failed: false,
          openCheckpoints: 0,
          openQuestions: 1,
        }),
        lastActivityAt: new Date(),
      })
      .where(eq(chats.id, chatId));
  }

  return {
    status: AWAITING_ANSWER,
    kind: "agent_question",
    toolName: ASK_OPERATOR_TOOL,
    questionId: row.id,
    question,
    suggestedAnswers,
    message:
      "Your turn ends here. Do not guess the answer; continue once the person replies.",
  };
}

export function makeAskOperatorTool(ctx: {
  companyId: string;
  agentId: string;
  parent: AskOperatorParent;
}) {
  return tool({
    description:
      "Ask a person at the company a question when you cannot continue without their input. Your turn ends after asking; the session or scheduled run waits until someone answers. Offer 2-4 short suggested answers when the choice is closed. Not for approvals: drafts that leave Relay go through proposeAction.",
    inputSchema: askOperatorInputSchema,
    execute: async (input) =>
      askOperator({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        parent: ctx.parent,
        input,
      }),
  });
}

/** Anthropic batch tool definition, same contract as `makeAskOperatorTool`. */
export const askOperatorAnthropicTool = {
  name: ASK_OPERATOR_TOOL,
  description:
    "Ask a person at the company a question when you cannot continue without their input. Your turn ends after asking; the run waits until someone answers. Offer 2-4 short suggested answers when the choice is closed.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string" },
      suggestedAnswers: {
        type: "array",
        items: { type: "string" },
        minItems: AGENT_QUESTION_MIN_SUGGESTIONS,
        maxItems: AGENT_QUESTION_MAX_SUGGESTIONS,
      },
    },
    required: ["question"],
  },
};

/** True when a tool output is an asked question (the turn must end). */
export function isAwaitingAnswer(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    "status" in output &&
    (output as { status: unknown }).status === AWAITING_ANSWER
  );
}

/** Open questions on a Schedule run; any one keeps it `awaiting_input`. */
export async function countOpenRunQuestions(cronRunId: string): Promise<number> {
  const rows = await db.query.agentQuestions.findMany({
    columns: { id: true },
    where: and(
      eq(agentQuestions.cronRunId, cronRunId),
      eq(agentQuestions.status, "open"),
    ),
  });
  return rows.length;
}

/**
 * A message typed in the session composer answers every open question on that
 * session (decision 9: answer on the card or in the composer). Returns the
 * ids it answered; a question already answered on its card is left alone.
 */
export async function answerOpenChatQuestions(args: {
  chatId: string;
  userId: string;
  answer: string;
  now?: Date;
}): Promise<string[]> {
  const answer = args.answer.trim();
  if (!answer) return [];
  const now = args.now ?? new Date();
  const answered = await db
    .update(agentQuestions)
    .set({
      status: "answered",
      answer,
      answeredByUserId: args.userId,
      answeredAt: now,
    })
    .where(
      and(
        eq(agentQuestions.chatId, args.chatId),
        eq(agentQuestions.status, "open"),
      ),
    )
    .returning({ id: agentQuestions.id });

  if (answered.length > 0) {
    const open = await db.query.checkpoints.findMany({
      columns: { id: true },
      where: and(
        eq(checkpoints.chatId, args.chatId),
        inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
        isNull(checkpoints.supersededBy),
      ),
    });
    await db
      .update(chats)
      .set({
        status: deriveSessionStatus({
          running: true,
          failed: false,
          openCheckpoints: open.length,
          openQuestions: 0,
        }),
        lastActivityAt: now,
      })
      .where(eq(chats.id, args.chatId));
  }

  return answered.map((row) => row.id);
}
