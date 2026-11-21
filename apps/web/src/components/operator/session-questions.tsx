"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AgentQuestion } from "@/components/v2/session/agent-question";

/** An agent question on this session (agent_questions row, chat parent). */
export type SessionQuestionView = {
  id: string;
  question: string;
  suggestedAnswers: string[];
  status: "open" | "answered";
  answer: string | null;
  answeredBy: string | null;
  /** Preformatted, e.g. "07:20". */
  askedAt: string;
  answeredAt: string | null;
};

type SessionQuestionsProps = {
  questions: SessionQuestionView[];
  agentName: string;
  /** Viewer may answer (steer gate checked server-side too). */
  canAnswer: boolean;
  /** Resumes the session with the answer as the chat message. */
  onAnswered: (answer: string) => void;
};

export type QuestionAnswerOutcome = "session" | "run" | "conflict" | "error";

/** Posts an answer; toasts on conflict or failure. */
export async function postQuestionAnswer(id: string, answer: string): Promise<QuestionAnswerOutcome> {
  const response = await fetch(`/api/operator/questions/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (response.status === 409) {
    toast.info("Someone already answered this question.");
    return "conflict";
  }
  if (!response.ok) {
    toast.error("Could not send your answer");
    return "error";
  }
  const body = (await response.json()) as { resume?: { kind: string } };
  return body.resume?.kind === "run" ? "run" : "session";
}

/**
 * Agent question cards in the conversation (05 session-leads/agent-question).
 * A quick reply posts to /api/operator/questions/:id; the session then
 * resumes with the answer as the person's message.
 */
export function SessionQuestions({ questions, agentName, canAnswer, onAnswered }: SessionQuestionsProps) {
  const [pending, setPending] = useState<string | null>(null);

  async function answer(id: string, reply: string) {
    if (pending) return;
    setPending(id);
    try {
      const outcome = await postQuestionAnswer(id, reply);
      if (outcome === "session") onAnswered(reply);
    } finally {
      setPending(null);
    }
  }

  if (questions.length === 0) return null;
  return (
    <div data-slot="session-questions" className="flex flex-col gap-3 px-4 pb-4">
      {questions.map((q) =>
        q.status === "open" ? (
          <AgentQuestion
            key={q.id}
            state="open"
            question={q.question}
            askedBy={agentName}
            askedAt={q.askedAt}
            replies={canAnswer ? q.suggestedAnswers : []}
            onReply={canAnswer && pending === null ? (reply) => void answer(q.id, reply) : undefined}
          />
        ) : (
          <AgentQuestion
            key={q.id}
            state="answered"
            question={q.question}
            askedBy={agentName}
            askedAt={q.askedAt}
            answer={q.answer ? { reply: q.answer, by: q.answeredBy ?? "Someone", at: q.answeredAt ?? undefined } : undefined}
          />
        ),
      )}
    </div>
  );
}
