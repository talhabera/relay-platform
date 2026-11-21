import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentQuestions, cronRunMessages } from "@/db/schema";
import { requireOperatorAgentAccess } from "@/lib/operator/access";
import { syncChatStatus } from "@/lib/operator/checkpoint-actions";
import { pokeCronContinue } from "@/lib/operator/cron-continue";

// Agent question answers (checkpoints spec decisions 8-12). Anyone who can
// steer the agent may answer, members included; approve rights gate
// checkpoints only. The answer resumes the session or the Schedule run.

export type AgentQuestion = typeof agentQuestions.$inferSelect;

/** Body of an answer: free text, or one of the agent's suggested answers. */
export const agentQuestionAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

export type AgentQuestionAnswerInput = z.infer<typeof agentQuestionAnswerSchema>;

/**
 * Steer gate for answering: the viewer must be able to use the question's
 * operator agent (`requireOperatorAgentAccess`), and the question must belong
 * to that agent's company. Throws `Unauthorized:` / `Not found`.
 */
export async function requireAgentQuestionAnswer(questionId: string) {
  const question = await db.query.agentQuestions.findFirst({
    where: eq(agentQuestions.id, questionId),
  });
  if (!question) {
    throw new Error("Not found: agent question");
  }
  const { session, agent } = await requireOperatorAgentAccess(question.agentId);
  if (agent.companyId !== question.companyId) {
    throw new Error("Unauthorized: You don't have access to this agent");
  }
  return { session, question };
}

export type AnswerAgentQuestionResult =
  | {
      ok: true;
      question: AgentQuestion;
      /**
       * Session: the caller sends the answer through the session chat so the
       * agent resumes in the stream. Run: already resumed (transcript written,
       * cron poked).
       */
      resume:
        | { kind: "session"; chatId: string; answer: string }
        | { kind: "run"; cronRunId: string };
    }
  | { ok: false; httpStatus: 400 | 404 | 409 };

/**
 * Answer an open question. The write is guarded on `status = 'open'`, so of
 * two people answering at once only one wins; the other gets 409. No expiry:
 * an open question can be answered any time.
 */
export async function answerAgentQuestion(input: {
  questionId: string;
  userId: string;
  answer: string;
  now?: Date;
}): Promise<AnswerAgentQuestionResult> {
  const now = input.now ?? new Date();
  const answer = input.answer.trim();
  if (!answer) {
    return { ok: false, httpStatus: 400 };
  }

  const question = await db.query.agentQuestions.findFirst({
    where: eq(agentQuestions.id, input.questionId),
  });
  if (!question) {
    return { ok: false, httpStatus: 404 };
  }
  if (question.status !== "open") {
    return { ok: false, httpStatus: 409 };
  }

  const claimed = await db
    .update(agentQuestions)
    .set({
      status: "answered",
      answer,
      answeredByUserId: input.userId,
      answeredAt: now,
    })
    .where(
      and(
        eq(agentQuestions.id, question.id),
        eq(agentQuestions.status, "open"),
      ),
    )
    .returning({ id: agentQuestions.id });
  if (claimed.length === 0) {
    return { ok: false, httpStatus: 409 };
  }

  const answered: AgentQuestion = {
    ...question,
    status: "answered",
    answer,
    answeredByUserId: input.userId,
    answeredAt: now,
  };

  if (question.cronRunId) {
    // The run transcript carries the answer; the agent reads it as the
    // person's direction when the run resumes.
    await db.insert(cronRunMessages).values({
      runId: question.cronRunId,
      role: "tool",
      content: JSON.stringify(agentQuestionToolResult(answered)),
    });
    await db.insert(cronRunMessages).values({
      runId: question.cronRunId,
      role: "user",
      content: answer,
    });
    await pokeCronContinue(question.cronRunId);
    return {
      ok: true,
      question: answered,
      resume: { kind: "run", cronRunId: question.cronRunId },
    };
  }

  const chatId = question.chatId!;
  await syncChatStatus(chatId, { running: true, now });
  return {
    ok: true,
    question: answered,
    resume: { kind: "session", chatId, answer },
  };
}

/** Tool result the agent and the transcript read for an answered question. */
export function agentQuestionToolResult(
  question: Pick<AgentQuestion, "id" | "question" | "answer">,
): Record<string, unknown> {
  return {
    kind: "agent_question_answer",
    questionId: question.id,
    question: question.question,
    answer: question.answer,
    status: "answered",
  };
}
