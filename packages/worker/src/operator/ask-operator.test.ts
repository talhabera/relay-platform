import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  insert,
  insertValues,
  update,
  updateSet,
  updateWhere,
  updateReturning,
  checkpointsFindMany,
  questionsFindMany,
} = vi.hoisted(() => ({
  insert: vi.fn(),
  insertValues: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  checkpointsFindMany: vi.fn(),
  questionsFindMany: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        checkpoints: { findMany: checkpointsFindMany },
        agentQuestions: { findMany: questionsFindMany },
      },
      insert,
      update,
    },
  };
});

import { agentQuestions, chats } from "@relay/db";
import {
  ASK_OPERATOR_TOOL,
  answerOpenChatQuestions,
  askOperator,
  askOperatorInputSchema,
  countOpenRunQuestions,
  isAwaitingAnswer,
  makeAskOperatorTool,
} from "./ask-operator";
import { selectOperatorTools } from "./tools";
import { selectCronOperatorTools } from "./cron-tools";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const chatId = "770e8400-e29b-41d4-a716-446655440002";
const cronRunId = "880e8400-e29b-41d4-a716-446655440003";
const questionId = "990e8400-e29b-41d4-a716-446655440004";

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockReturnValue({ values: insertValues });
  insertValues.mockReturnValue({
    returning: vi.fn(async () => [{ id: questionId }]),
  });
  update.mockReturnValue({ set: updateSet });
  updateSet.mockReturnValue({ where: updateWhere });
  updateWhere.mockReturnValue({
    returning: updateReturning,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
  });
  updateReturning.mockResolvedValue([]);
  checkpointsFindMany.mockResolvedValue([]);
  questionsFindMany.mockResolvedValue([]);
});

describe("askOperatorInputSchema", () => {
  it("accepts no suggestions or 2-4 suggestions", () => {
    expect(askOperatorInputSchema.safeParse({ question: "Which city?" }).success).toBe(true);
    expect(
      askOperatorInputSchema.safeParse({
        question: "Which city?",
        suggestedAnswers: ["Istanbul", "Ankara"],
      }).success,
    ).toBe(true);
    expect(
      askOperatorInputSchema.safeParse({
        question: "Which city?",
        suggestedAnswers: ["a", "b", "c", "d"],
      }).success,
    ).toBe(true);
  });

  it("refuses one suggestion, five suggestions and an empty question", () => {
    expect(
      askOperatorInputSchema.safeParse({ question: "Q", suggestedAnswers: ["only"] }).success,
    ).toBe(false);
    expect(
      askOperatorInputSchema.safeParse({
        question: "Q",
        suggestedAnswers: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
    expect(askOperatorInputSchema.safeParse({ question: "   " }).success).toBe(false);
  });
});

describe("askOperator", () => {
  it("opens a question on the session and marks the session needs_you", async () => {
    const result = await askOperator({
      companyId,
      agentId,
      parent: { chatId },
      input: { question: "Which list?", suggestedAnswers: ["Istanbul", "Ankara"] },
    });

    expect(insert).toHaveBeenCalledWith(agentQuestions);
    expect(insertValues).toHaveBeenCalledWith({
      companyId,
      agentId,
      chatId,
      cronRunId: null,
      question: "Which list?",
      suggestedAnswers: ["Istanbul", "Ankara"],
      status: "open",
    });
    expect(update).toHaveBeenCalledWith(chats);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs_you" }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "awaiting_answer",
        kind: "agent_question",
        toolName: ASK_OPERATOR_TOOL,
        questionId,
        suggestedAnswers: ["Istanbul", "Ankara"],
      }),
    );
    expect(isAwaitingAnswer(result)).toBe(true);
  });

  it("opens a question on a Schedule run without touching chats", async () => {
    const result = await askOperator({
      companyId,
      agentId,
      parent: { cronRunId },
      input: { question: "Skip weekends?" },
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: null, cronRunId, suggestedAnswers: [] }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(isAwaitingAnswer(result)).toBe(true);
  });

  it("refuses an invalid question without writing", async () => {
    const result = await askOperator({
      companyId,
      agentId,
      parent: { chatId },
      input: { question: "Q", suggestedAnswers: ["only one"] },
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(isAwaitingAnswer(result)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("runs as a tool bound to its tenant and parent", async () => {
    const askTool = makeAskOperatorTool({ companyId, agentId, parent: { cronRunId } });
    const output = await askTool.execute!(
      { question: "Which segment?", suggestedAnswers: ["SMB", "Mid-market"] },
      { toolCallId: "call-1", messages: [], abortSignal: undefined },
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, agentId, cronRunId, chatId: null }),
    );
    expect(isAwaitingAnswer(output)).toBe(true);
  });
});

describe("tool registration", () => {
  const toggles = {
    webSearch: false,
    excel: false,
    companyMemory: false,
    proposeAction: false,
  };

  it("offers ask_operator in sessions and Schedule runs regardless of toggles", () => {
    expect(
      selectOperatorTools({ version: { toolToggles: toggles }, chatId, agentId, companyId })[
        ASK_OPERATOR_TOOL
      ],
    ).toBeDefined();
    expect(
      selectCronOperatorTools({ version: { toolToggles: toggles }, cronRunId, agentId, companyId })[
        ASK_OPERATOR_TOOL
      ],
    ).toBeDefined();
  });
});

describe("answerOpenChatQuestions", () => {
  it("answers every open question on the session and recomputes its status", async () => {
    updateReturning.mockResolvedValueOnce([{ id: questionId }]);
    const now = new Date("2026-10-03T10:00:00.000Z");

    const ids = await answerOpenChatQuestions({
      chatId,
      userId: "user-1",
      answer: "  Istanbul  ",
      now,
    });

    expect(ids).toEqual([questionId]);
    expect(update).toHaveBeenNthCalledWith(1, agentQuestions);
    expect(updateSet).toHaveBeenNthCalledWith(1, {
      status: "answered",
      answer: "Istanbul",
      answeredByUserId: "user-1",
      answeredAt: now,
    });
    expect(update).toHaveBeenNthCalledWith(2, chats);
    expect(updateSet).toHaveBeenNthCalledWith(2, {
      status: "running",
      lastActivityAt: now,
    });
  });

  it("keeps needs_you when a checkpoint is still open", async () => {
    updateReturning.mockResolvedValueOnce([{ id: questionId }]);
    checkpointsFindMany.mockResolvedValueOnce([{ id: "cp-1" }]);

    await answerOpenChatQuestions({ chatId, userId: "user-1", answer: "Yes" });

    expect(updateSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "needs_you" }),
    );
  });

  it("does nothing for an empty reply or when no question is open", async () => {
    expect(await answerOpenChatQuestions({ chatId, userId: "u", answer: "  " })).toEqual([]);
    expect(update).not.toHaveBeenCalled();

    expect(await answerOpenChatQuestions({ chatId, userId: "u", answer: "ok" })).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("countOpenRunQuestions", () => {
  it("counts open questions on the run", async () => {
    questionsFindMany.mockResolvedValueOnce([{ id: "q-1" }, { id: "q-2" }]);
    expect(await countOpenRunQuestions(cronRunId)).toBe(2);
  });
});
