import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, requireAgentQuestionAnswer, answerAgentQuestion } = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireAgentQuestionAnswer: vi.fn(),
  answerAgentQuestion: vi.fn(),
}));

vi.mock("@/lib/auth-server", () => ({ getSession }));
vi.mock("@/lib/operator/agent-questions", async () => {
  const { z } = await import("zod");
  return {
    agentQuestionAnswerSchema: z.object({ answer: z.string().trim().min(1).max(4000) }),
    requireAgentQuestionAnswer,
    answerAgentQuestion,
  };
});

import { POST } from "./route";

const params = (id = "q-1") => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/api/operator/questions/q-1", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  requireAgentQuestionAnswer.mockResolvedValue({ question: { id: "q-1" } });
  answerAgentQuestion.mockResolvedValue({
    ok: true,
    question: { id: "q-1" },
    resume: { kind: "session", chatId: "chat-1", answer: "Yes, include them" },
  });
});

describe("POST /api/operator/questions/[id]", () => {
  it("answers through the steer gate and returns how to resume", async () => {
    const response = await POST(post({ answer: "Yes, include them" }), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resume: { kind: "session", chatId: "chat-1", answer: "Yes, include them" },
    });
    expect(requireAgentQuestionAnswer).toHaveBeenCalledWith("q-1");
    expect(answerAgentQuestion).toHaveBeenCalledWith({ questionId: "q-1", userId: "u1", answer: "Yes, include them" });
  });

  it("409 when someone answered first", async () => {
    answerAgentQuestion.mockResolvedValue({ ok: false, httpStatus: 409 });
    expect((await POST(post({ answer: "No" }), params())).status).toBe(409);
  });

  it("401 / 400 / 403 / 404 before any write", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await POST(post({ answer: "x" }), params())).status).toBe(401);

    expect((await POST(post({ answer: "  " }), params())).status).toBe(400);

    requireAgentQuestionAnswer.mockRejectedValueOnce(new Error("Unauthorized: no"));
    expect((await POST(post({ answer: "x" }), params())).status).toBe(403);

    requireAgentQuestionAnswer.mockRejectedValueOnce(new Error("Not found: agent question"));
    expect((await POST(post({ answer: "x" }), params())).status).toBe(404);

    expect(answerAgentQuestion).not.toHaveBeenCalled();
  });
});
