import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-server";
import {
  listCronJobs as listCronJobsOp,
  createCronJob as createCronJobOp,
  updateCronJob as updateCronJobOp,
  deleteCronJob as deleteCronJobOp,
  runCronJobNow as runCronJobNowOp,
  CronRunNowError,
} from "@relay/agent-ops";
import { revalidatePath } from "next/cache";
import {
  createCronJob,
  deleteCronJob,
  listCronJobs,
  runCronJobNowAction,
  updateCronJob,
} from "./cron-actions";

vi.mock("@relay/agent-ops", () => {
  class CronRunNowError extends Error {
    constructor(
      message: string,
      readonly code: "disabled" | "paused_run",
    ) {
      super(message);
      this.name = "CronRunNowError";
    }
  }
  return {
    listCronJobs: vi.fn(),
    createCronJob: vi.fn(),
    updateCronJob: vi.fn(),
    deleteCronJob: vi.fn(),
    runCronJobNow: vi.fn(),
    CronRunNowError,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const versionId = "770e8400-e29b-41d4-a716-446655440002";
const jobId = "990e8400-e29b-41d4-a716-446655440004";

const session = {
  user: { id: "user-1", name: "Ada", email: "ada@relay.dev", image: null },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

describe("createCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("propagates operator agent rejection from agent-ops", async () => {
    vi.mocked(createCronJobOp).mockRejectedValue(
      new Error("Unauthorized: This agent is not an operator agent"),
    );

    await expect(
      createCronJob({
        agentId,
        versionId,
        name: "Sync",
        prompt: "Go",
        scheduleKind: "interval",
        intervalMinutes: 30,
      }),
    ).rejects.toThrow("not an operator agent");
  });

  it("propagates edit access rejection from agent-ops", async () => {
    vi.mocked(createCronJobOp).mockRejectedValue(
      new Error(
        "Unauthorized: You don't have edit access to this operator agent",
      ),
    );

    await expect(
      createCronJob({
        agentId,
        versionId,
        name: "Sync",
        prompt: "Go",
        scheduleKind: "interval",
        intervalMinutes: 30,
      }),
    ).rejects.toThrow("edit access");
  });

  it("delegates cron job creation to agent-ops", async () => {
    vi.mocked(createCronJobOp).mockResolvedValue({ id: jobId });

    const input = {
      agentId,
      versionId,
      name: "Sync",
      prompt: "Go",
      scheduleKind: "interval" as const,
      intervalMinutes: 30,
      timezone: "UTC",
    };

    const result = await createCronJob(input);

    expect(createCronJobOp).toHaveBeenCalledWith("user-1", input);
    expect(result).toEqual({ id: jobId });
  });
});

describe("listCronJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("delegates listing to agent-ops with company filter", async () => {
    vi.mocked(listCronJobsOp).mockResolvedValue([
      { id: jobId, name: "Sync" },
    ] as never);

    const jobs = await listCronJobs(companyId);

    expect(listCronJobsOp).toHaveBeenCalledWith("user-1", { companyId });
    expect(jobs).toHaveLength(1);
  });
});

describe("updateCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("delegates schedule updates to agent-ops", async () => {
    vi.mocked(updateCronJobOp).mockResolvedValue(undefined);

    await updateCronJob(jobId, {
      scheduleKind: "interval",
      intervalMinutes: 60,
    });

    expect(updateCronJobOp).toHaveBeenCalledWith("user-1", jobId, {
      scheduleKind: "interval",
      intervalMinutes: 60,
    });
  });

  it("propagates schedule validation errors from agent-ops", async () => {
    vi.mocked(updateCronJobOp).mockRejectedValue(
      new Error("intervalMinutes must be at least 15"),
    );

    await expect(
      updateCronJob(jobId, {
        intervalMinutes: 7,
      }),
    ).rejects.toThrow(/intervalMinutes/);
  });

  it("delegates name-only updates to agent-ops", async () => {
    vi.mocked(updateCronJobOp).mockResolvedValue(undefined);

    await updateCronJob(jobId, {
      name: "Renamed",
    });

    expect(updateCronJobOp).toHaveBeenCalledWith("user-1", jobId, {
      name: "Renamed",
    });
  });
});

describe("deleteCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("delegates delete to agent-ops", async () => {
    vi.mocked(deleteCronJobOp).mockResolvedValue(undefined);

    await deleteCronJob(jobId);

    expect(deleteCronJobOp).toHaveBeenCalledWith("user-1", jobId);
  });
});

describe("runCronJobNowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("queues the job with the session user id and the job id", async () => {
    vi.mocked(runCronJobNowOp).mockResolvedValue(undefined);

    const result = await runCronJobNowAction(jobId);

    expect(runCronJobNowOp).toHaveBeenCalledWith("user-1", jobId);
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
    expect(result).toEqual({ ok: true });
  });

  it("returns the refusal message when agent-ops refuses", async () => {
    vi.mocked(runCronJobNowOp).mockRejectedValue(
      new CronRunNowError(
        "Schedule is paused: turn it on before running it now",
        "disabled",
      ),
    );

    const result = await runCronJobNowAction(jobId);

    expect(result).toEqual({
      error: "Schedule is paused: turn it on before running it now",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("propagates other errors from agent-ops", async () => {
    vi.mocked(runCronJobNowOp).mockRejectedValue(
      new Error(
        "Unauthorized: You don't have edit access to this operator agent",
      ),
    );

    await expect(runCronJobNowAction(jobId)).rejects.toThrow("edit access");
  });
});
