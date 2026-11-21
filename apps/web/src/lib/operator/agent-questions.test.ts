import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator/access", () => ({
  requireOperatorAgentAccess: vi.fn(),
}));

vi.mock("@/lib/operator/cron-continue", () => ({
  pokeCronContinue: vi.fn(async () => undefined),
}));

import { db } from "@/db";
import { agentQuestions, chats, cronRunMessages } from "@/db/schema";
import { requireOperatorAgentAccess } from "@/lib/operator/access";
import { pokeCronContinue } from "@/lib/operator/cron-continue";
import {
  agentQuestionAnswerSchema,
  answerAgentQuestion,
  requireAgentQuestionAnswer,
} from "./agent-questions";

const now = new Date("2026-10-03T10:00:00.000Z");

const baseQuestion = {
  id: "q-1",
  companyId: "company-1",
  agentId: "agent-1",
  chatId: null as string | null,
  cronRunId: null as string | null,
  question: "Which city should I target?",
  suggestedAnswers: ["Istanbul", "Ankara"],
  status: "open" as const,
  answer: null,
  answeredByUserId: null,
  answeredAt: null,
  createdAt: new Date("2026-10-03T09:00:00.000Z"),
};

type Captured = { table: unknown; values: unknown };

function captureWrites(claimed: boolean) {
  const updates: Captured[] = [];
  const inserts: Captured[] = [];
  vi.mocked(db.update).mockImplementation(
    (table: unknown) =>
      ({
        set: (values: unknown) => {
          updates.push({ table, values });
          const result = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<unknown[]>;
          };
          result.returning = async () => (claimed ? [{ id: "q-1" }] : []);
          return { where: () => result };
        },
      }) as never,
  );
  vi.mocked(db.insert).mockImplementation(
    (table: unknown) =>
      ({
        values: async (values: unknown) => {
          inserts.push({ table, values });
        },
      }) as never,
  );
  return { updates, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([]);
  vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
});

describe("agentQuestionAnswerSchema", () => {
  it("needs a non-empty answer", () => {
    expect(agentQuestionAnswerSchema.safeParse({ answer: "Istanbul" }).success).toBe(true);
    expect(agentQuestionAnswerSchema.safeParse({ answer: "  " }).success).toBe(false);
  });
});

describe("answerAgentQuestion", () => {
  it("answers a session question and moves the session back to running", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue({
      ...baseQuestion,
      chatId: "chat-1",
    } as never);
    const { updates, inserts } = captureWrites(true);

    const result = await answerAgentQuestion({
      questionId: "q-1",
      userId: "member-1",
      answer: " Istanbul ",
      now,
    });

    expect(result).toMatchObject({
      ok: true,
      question: { status: "answered", answer: "Istanbul", answeredByUserId: "member-1" },
      resume: { kind: "session", chatId: "chat-1", answer: "Istanbul" },
    });
    expect(updates[0]).toEqual({
      table: agentQuestions,
      values: {
        status: "answered",
        answer: "Istanbul",
        answeredByUserId: "member-1",
        answeredAt: now,
      },
    });
    expect(updates[1]).toEqual({
      table: chats,
      values: { status: "running", lastActivityAt: now },
    });
    expect(inserts).toHaveLength(0);
    expect(pokeCronContinue).not.toHaveBeenCalled();
  });

  it("writes the answer to the run transcript and resumes the run", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue({
      ...baseQuestion,
      cronRunId: "run-1",
    } as never);
    const { inserts } = captureWrites(true);

    const result = await answerAgentQuestion({
      questionId: "q-1",
      userId: "owner-1",
      answer: "Ankara",
      now,
    });

    expect(result).toMatchObject({ ok: true, resume: { kind: "run", cronRunId: "run-1" } });
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.table).toBe(cronRunMessages);
    expect(inserts[0]!.values).toMatchObject({ runId: "run-1", role: "tool" });
    expect(JSON.parse((inserts[0]!.values as { content: string }).content)).toEqual({
      kind: "agent_question_answer",
      questionId: "q-1",
      question: baseQuestion.question,
      answer: "Ankara",
      status: "answered",
    });
    expect(inserts[1]!.values).toEqual({ runId: "run-1", role: "user", content: "Ankara" });
    expect(pokeCronContinue).toHaveBeenCalledWith("run-1");
  });

  it("returns 409 for an answered question and for the loser of a race", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValueOnce({
      ...baseQuestion,
      chatId: "chat-1",
      status: "answered",
      answer: "x",
      answeredAt: now,
    } as never);
    captureWrites(true);
    expect(
      await answerAgentQuestion({ questionId: "q-1", userId: "u", answer: "y", now }),
    ).toEqual({ ok: false, httpStatus: 409 });

    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValueOnce({
      ...baseQuestion,
      cronRunId: "run-1",
    } as never);
    const { inserts } = captureWrites(false);
    expect(
      await answerAgentQuestion({ questionId: "q-1", userId: "u", answer: "y", now }),
    ).toEqual({ ok: false, httpStatus: 409 });
    expect(inserts).toHaveLength(0);
    expect(pokeCronContinue).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing question and 400 for an empty answer", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue(undefined);
    expect(
      await answerAgentQuestion({ questionId: "nope", userId: "u", answer: "y" }),
    ).toEqual({ ok: false, httpStatus: 404 });
    expect(
      await answerAgentQuestion({ questionId: "q-1", userId: "u", answer: "   " }),
    ).toEqual({ ok: false, httpStatus: 400 });
  });
});

describe("requireAgentQuestionAnswer", () => {
  it("passes anyone who can steer the agent (no approve rights needed)", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue({
      ...baseQuestion,
      chatId: "chat-1",
    } as never);
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      session: { user: { id: "member-1" } },
      agent: { id: "agent-1", companyId: "company-1" },
    } as never);

    const { question } = await requireAgentQuestionAnswer("q-1");
    expect(question.id).toBe("q-1");
    expect(requireOperatorAgentAccess).toHaveBeenCalledWith("agent-1");
  });

  it("refuses a viewer who cannot steer and a cross-company mismatch", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue({
      ...baseQuestion,
      chatId: "chat-1",
    } as never);
    vi.mocked(requireOperatorAgentAccess).mockRejectedValueOnce(
      new Error("Unauthorized: You don't have access to this company"),
    );
    await expect(requireAgentQuestionAnswer("q-1")).rejects.toThrow("Unauthorized:");

    vi.mocked(requireOperatorAgentAccess).mockResolvedValueOnce({
      session: { user: { id: "u" } },
      agent: { id: "agent-1", companyId: "company-2" },
    } as never);
    await expect(requireAgentQuestionAnswer("q-1")).rejects.toThrow("Unauthorized:");
  });

  it("refuses a missing question", async () => {
    vi.mocked(db.query.agentQuestions.findFirst).mockResolvedValue(undefined);
    await expect(requireAgentQuestionAnswer("q-x")).rejects.toThrow("Not found");
  });
});
