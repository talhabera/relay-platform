import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockUpdate, mockUpdateReturning } = vi.hoisted(() => {
  const mockUpdateReturning = vi.fn(async (): Promise<unknown[]> => [
    { id: "run-1" },
  ]);
  function createWhere() {
    const returning = vi.fn(() => mockUpdateReturning());
    return {
      returning,
      then(
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(undefined).then(onFulfilled, onRejected);
      },
    };
  }

  const set = vi.fn(() => ({ where: vi.fn(() => createWhere()) }));
  const update = vi.fn(() => ({ set }));
  return { mockUpdate: update, mockUpdateReturning };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        cronRuns: { findFirst: vi.fn(), findMany: vi.fn() },
        cronRunMessages: { findMany: vi.fn() },
        cronJobs: { findFirst: vi.fn() },
        agents: { findFirst: vi.fn() },
        companies: { findFirst: vi.fn() },
        agentVersions: { findFirst: vi.fn() },
        knowledgeBase: { findMany: vi.fn() },
        checkpoints: { findFirst: vi.fn(), findMany: vi.fn() },
        agentQuestions: { findMany: vi.fn(async () => []) },
      },
      update: mockUpdate,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(() => [{ id: "msg-1" }]) })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
      selectDistinct: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    },
  };
});

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({
    text: "assistant reply",
    usage: { totalTokens: 12 },
    steps: [],
  })),
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(async () => []),
  stepCountIs: vi.fn(() => () => false),
  hasToolCall: vi.fn((name: string) => `hasToolCall:${name}`),
}));

vi.mock("./anthropic-batch", () => ({
  submitMessageBatch: vi.fn(),
  pollMessageBatch: vi.fn(),
  fetchMessageBatchResults: vi.fn(),
}));

vi.mock("./ai/token-limiter", () => ({
  checkTokenBudget: vi.fn(async () => ({
    allowed: true,
    used: 0,
    limit: 50_000,
    remaining: 50_000,
    resetsAt: "2026-09-01T00:00:00.000Z",
  })),
  recordTokenUsage: vi.fn(),
}));

vi.mock("./operator/cron-tools", () => ({
  selectCronOperatorTools: vi.fn(() => ({})),
  executeCronExcelWorkbook: vi.fn(async () => ({
    fileId: "file-1",
    filename: "report.xlsx",
    rowCount: 1,
    downloadPath: "/api/operator/cron/runs/run-1/files/file-1",
  })),
}));

vi.mock("./operator/system-prompt", () => ({
  buildOperatorSystemPrompt: vi.fn(() => "cron prompt"),
}));

vi.mock("./leads/borderline-question", () => ({
  postBorderlineQuestion: vi.fn(async () => null),
  borderlineAnswersForAgent: vi.fn(async () => null),
}));

import { db } from "@relay/db";
import { generateText } from "ai";
import {
  fetchMessageBatchResults,
  pollMessageBatch,
  submitMessageBatch,
} from "./anthropic-batch";
import { executeCronExcelWorkbook, selectCronOperatorTools } from "./operator/cron-tools";
import { recordTokenUsage } from "./ai/token-limiter";
import {
  borderlineAnswersForAgent,
  postBorderlineQuestion,
} from "./leads/borderline-question";
import { buildOperatorSystemPrompt } from "./operator/system-prompt";
import {
  buildAnthropicTools,
  continueCronRun,
  failStuckLiveRuns,
  pollOpenBatches,
  resumeApprovedCronRuns,
  runLiveCron,
  stuckLiveRunWhere,
} from "./cron-run";

const baseRun = {
  id: "run-1",
  jobId: "job-1",
  status: "running" as const,
  fireAt: new Date("2026-08-28T12:00:00Z"),
  startedAt: new Date("2026-08-28T12:00:00Z"),
  finishedAt: null,
  error: null,
  anthropicBatchId: null,
  createdAt: new Date("2026-08-28T12:00:00Z"),
};

const baseJob = {
  id: "job-1",
  companyId: "company-1",
  agentId: "agent-1",
  versionId: "version-1",
  name: "Daily",
  prompt: "go",
  scheduleKind: "interval" as const,
  intervalMinutes: 10,
  weekday: null,
  timeOfDay: null,
  timezone: "UTC",
  enabled: true,
  nextFireAt: new Date("2026-08-28T12:10:00Z"),
  createdByUserId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockLiveContext() {
  vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue(baseRun as never);
  vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue(baseJob as never);
  vi.mocked(db.query.cronRunMessages.findMany).mockResolvedValue([
    {
      id: "m1",
      runId: "run-1",
      role: "user",
      content: "go",
      metadata: null,
      createdAt: new Date(),
    },
  ] as never);
  vi.mocked(db.query.agents.findFirst).mockResolvedValue({
    id: "agent-1",
    kind: "operator",
    name: "Ops",
    companyId: "company-1",
    persona: "professional",
    responseLength: "medium",
    language: "en",
  } as never);
  vi.mocked(db.query.companies.findFirst).mockResolvedValue({
    id: "company-1",
    name: "Co",
  } as never);
  vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
    id: "version-1",
    instructions: null,
    toolToggles: {
      webSearch: false,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    },
  } as never);
  vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([]);
}

function mockBatchRunContext() {
  mockLiveContext();
  vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
    ...baseRun,
    anthropicBatchId: "batch-1",
  } as never);
  vi.mocked(db.query.cronRuns.findMany).mockResolvedValue([
    {
      ...baseRun,
      anthropicBatchId: "batch-1",
    },
  ] as never);
  vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
    id: "version-1",
    instructions: null,
    toolToggles: {
      webSearch: false,
      excel: true,
      companyMemory: false,
      proposeAction: false,
    },
  } as never);
}

describe("runLiveCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
  });

  it("calls generateText not submitMessageBatch", async () => {
    await runLiveCron("run-1");
    expect(generateText).toHaveBeenCalled();
    expect(submitMessageBatch).not.toHaveBeenCalled();
  });

  it("passes the Schedule's package slug to tool selection", async () => {
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue({
      ...baseJob,
      packageSlug: "insights",
    } as never);
    await runLiveCron("run-1");
    expect(selectCronOperatorTools).toHaveBeenCalledWith(
      expect.objectContaining({ packageSlug: "insights" }),
    );
  });
});

describe("continueCronRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
  });

  it("does not call the model when a pending outreach action remains", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "action-1",
        cronRunId: "run-1",
        status: "pending",
      },
    ] as never);

    await continueCronRun("run-1");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("calls generateText when no pending outreach actions remain", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "action-1",
        cronRunId: "run-1",
        status: "approved",
      },
    ] as never);

    await continueCronRun("run-1");
    expect(generateText).toHaveBeenCalled();
  });

  it("runs exactly one model turn when two continues race", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: "action-1", cronRunId: "run-1", status: "approved" },
    ] as never);
    // Postgres lets only the first guarded update see awaiting_input.
    let claimed = false;
    mockUpdateReturning.mockImplementation(async () => {
      if (claimed) return [];
      claimed = true;
      return [{ id: "run-1" }];
    });

    await Promise.all([continueCronRun("run-1"), continueCronRun("run-1")]);

    expect(generateText).toHaveBeenCalledTimes(1);
    mockUpdateReturning.mockImplementation(async () => [{ id: "run-1" }]);
  });

  it("guards the awaiting_input to running claim on status", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    await continueCronRun("run-1");

    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("continueCronRun with an open agent question", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([]);
  });

  it("stays paused while an agent question is open", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([
      { id: "q-1" },
    ] as never);

    await continueCronRun("run-1");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("resumes once the question is answered", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);

    await continueCronRun("run-1");
    expect(generateText).toHaveBeenCalled();
    const call = vi.mocked(generateText).mock.calls.at(-1)![0] as {
      stopWhen: unknown[];
    };
    expect(call.stopWhen).toContain("hasToolCall:ask_operator");
  });

  it("pauses the run when the turn asked a question", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "",
      usage: { totalTokens: 5 },
      steps: [
        {
          toolResults: [
            {
              toolName: "ask_operator",
              output: { status: "awaiting_answer", questionId: "q-1" },
            },
          ],
        },
      ],
    } as never);

    await continueCronRun("run-1");

    const sets = mockUpdate.mock.results
      .map((r) => (r.value as { set: { mock: { calls: unknown[][] } } }).set)
      .flatMap((set) => set.mock.calls.map((c) => c[0]));
    expect(sets).toContainEqual({ status: "awaiting_input" });
    expect(sets).not.toContainEqual(
      expect.objectContaining({ status: "succeeded" }),
    );
  });
});

describe("continueCronRun with S10 checkpoint states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
  });

  it.each(["stale", "failed"])("stays paused on a %s card", async (status) => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: "a1", cronRunId: "run-1", status, supersededBy: null },
    ] as never);
    await continueCronRun("run-1");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("resumes after Discard and after Ask for changes", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: "a1", cronRunId: "run-1", status: "discarded", supersededBy: null },
      { id: "a2", cronRunId: "run-1", status: "changes_requested", supersededBy: null },
      { id: "a3", cronRunId: "run-1", status: "stale", supersededBy: "a4" },
    ] as never);
    await continueCronRun("run-1");
    expect(generateText).toHaveBeenCalled();
  });
});

describe("failStuckLiveRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fail rows with anthropicBatchId set", async () => {
    const now = new Date("2026-08-28T12:20:00Z");
    const where = stuckLiveRunWhere(now);
    if (!where) throw new Error("expected a where clause");
    const { sql: sqlText } = new PgDialect().sqlToQuery(where);
    expect(sqlText).toContain("anthropic_batch_id");
    expect(sqlText.toLowerCase()).toContain("is null");

    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "run-live" }]),
        }),
      }),
    } as never);

    const count = await failStuckLiveRuns(now);
    expect(count).toBe(1);
  });
});

describe("pollOpenBatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBatchRunContext();
    vi.mocked(db.selectDistinct).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ batchId: "batch-1" }]),
      })),
    } as never);
    vi.mocked(pollMessageBatch).mockResolvedValue("ended");
    vi.mocked(fetchMessageBatchResults).mockResolvedValue([
      {
        customId: "run-1",
        ok: true,
        body: {
          content: [
            { type: "text", text: "building workbook" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "createExcelWorkbook",
              input: {
                filename: "report.xlsx",
                sheets: [{ name: "Sheet1", rows: [["a", "b"]] }],
              },
            },
          ],
        },
      },
    ]);
  });

  it("continues live with generateText after batch excel tool", async () => {
    await pollOpenBatches(new Date("2026-08-28T12:05:00Z"));

    expect(executeCronExcelWorkbook).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalled();
  });

  it("records token usage from batch message usage", async () => {
    vi.mocked(fetchMessageBatchResults).mockResolvedValue([
      {
        customId: "run-1",
        ok: true,
        body: {
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: "done" }],
        },
      },
    ]);

    await pollOpenBatches(new Date("2026-08-28T12:05:00Z"));

    expect(recordTokenUsage).toHaveBeenCalledWith("user-1", "user", 15);
  });
});

describe("resumeApprovedCronRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
  });

  it("continues runs awaiting approval when no pending actions remain", async () => {
    vi.mocked(db.query.cronRuns.findMany).mockResolvedValue([
      {
        ...baseRun,
        status: "awaiting_input",
      },
    ] as never);
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      ...baseRun,
      status: "awaiting_input",
    } as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "action-1",
        cronRunId: "run-1",
        status: "approved",
      },
    ] as never);

    await resumeApprovedCronRuns();

    expect(generateText).toHaveBeenCalled();
  });

  it("does not continue while a pending outreach action remains", async () => {
    vi.mocked(db.query.cronRuns.findMany).mockResolvedValue([
      {
        ...baseRun,
        status: "awaiting_input",
      },
    ] as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "action-1",
        cronRunId: "run-1",
        status: "pending",
      },
    ] as never);

    await resumeApprovedCronRuns();

    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("buildAnthropicTools", () => {
  it("includes company memory and proposeAction json names when toggles are on", () => {
    const names = buildAnthropicTools({
      webSearch: false,
      excel: false,
      companyMemory: true,
      proposeAction: true,
    }).map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "searchCompanyRecords",
        "getCompanyRecord",
        "upsertCompanyRecord",
        "proposeAction",
      ]),
    );
    expect(names).not.toContain("callNamedHttpEndpoint");
  });

  it("always offers ask_operator to batch runs", () => {
    const names = buildAnthropicTools({}).map((tool) => tool.name);
    expect(names).toContain("ask_operator");
  });
});

describe("borderline answers reach the next run (W3GAP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
  });

  it("adds the agent's answered borderline questions to the run's instructions", async () => {
    vi.mocked(borderlineAnswersForAgent).mockResolvedValueOnce("BORDERLINE ANSWERS");
    await runLiveCron("run-1");
    expect(borderlineAnswersForAgent).toHaveBeenCalledWith("agent-1");
    expect(vi.mocked(buildOperatorSystemPrompt).mock.calls[0][0]).toMatchObject({
      versionInstructions: expect.stringContaining("BORDERLINE ANSWERS"),
    });
  });

  it("leaves the instructions alone with nothing answered", async () => {
    await runLiveCron("run-1");
    expect(vi.mocked(buildOperatorSystemPrompt).mock.calls[0][0]).toMatchObject({
      versionInstructions: null,
    });
  });
});

describe("borderline question after a run (S27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveContext();
  });

  function statusSets() {
    return mockUpdate.mock.results
      .map((r) => (r.value as { set: { mock: { calls: unknown[][] } } }).set)
      .flatMap((set) => set.mock.calls.map((c) => c[0]));
  }

  it("posts it once the run has succeeded, never pausing the run", async () => {
    await runLiveCron("run-1");

    expect(postBorderlineQuestion).toHaveBeenCalledWith("run-1");
    const sets = statusSets();
    expect(sets).toContainEqual(expect.objectContaining({ status: "succeeded" }));
    expect(sets).not.toContainEqual({ status: "awaiting_input" });
    const succeededOrder = mockUpdate.mock.invocationCallOrder.at(-1)!;
    expect(
      vi.mocked(postBorderlineQuestion).mock.invocationCallOrder[0],
    ).toBeGreaterThan(succeededOrder);
  });

  it("a failing question does not fail the run", async () => {
    vi.mocked(postBorderlineQuestion).mockRejectedValueOnce(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await runLiveCron("run-1");

    const sets = statusSets();
    expect(sets).toContainEqual(expect.objectContaining({ status: "succeeded" }));
    expect(sets).not.toContainEqual(expect.objectContaining({ status: "failed" }));
    log.mockRestore();
  });

  it("is not posted while the run waits on a person", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "",
      usage: { totalTokens: 5 },
      steps: [
        {
          toolResults: [
            {
              toolName: "ask_operator",
              output: { status: "awaiting_answer", questionId: "q-1" },
            },
          ],
        },
      ],
    } as never);

    await runLiveCron("run-1");

    expect(postBorderlineQuestion).not.toHaveBeenCalled();
  });
});
