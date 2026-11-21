import { describe, expect, it, vi } from "vitest";
import { isInFlightStatus, partitionMode, runCronTick, type TickDeps } from "./cron-tick";

function due(id: string) {
  return {
    id,
    nextFireAt: new Date("2026-08-28T12:00:00Z"),
    inFlight: false,
    schedule: { kind: "interval" as const, intervalMinutes: 10 as const, timezone: "UTC" },
    prompt: "go",
    createdByUserId: "u1",
    companyId: "c1",
  };
}

function baseDeps(overrides: Partial<TickDeps> = {}): TickDeps {
  const startLive = vi.fn(async () => {});
  const startBatch = vi.fn(async () => {});
  return {
    tryLock: async () => true,
    unlock: async () => {},
    loadDueJobs: async () => [],
    insertRun: vi.fn(async () => "run-1"),
    savePromptMessage: vi.fn(async () => {}),
    bumpNextFireAt: vi.fn(async () => {}),
    checkRunLimit: vi.fn(async () => null),
    startLive,
    startBatch,
    ...overrides,
  };
}

describe("partitionMode", () => {
  it("uses live for one job and batch for two", () => {
    expect(partitionMode(1)).toBe("live");
    expect(partitionMode(2)).toBe("batch");
  });
});

describe("isInFlightStatus", () => {
  it("skips running and awaiting_input", () => {
    expect(isInFlightStatus("running")).toBe(true);
    expect(isInFlightStatus("awaiting_input")).toBe(true);
    expect(isInFlightStatus("succeeded")).toBe(false);
  });
});

describe("runCronTick", () => {
  it("returns idle when lock is held", async () => {
    const deps = baseDeps({ tryLock: async () => false });
    const result = await runCronTick(new Date(), deps);
    expect(result.mode).toBe("idle");
    expect(deps.startLive).not.toHaveBeenCalled();
  });

  it("skips in-flight jobs without inserting a run", async () => {
    const insertRun = vi.fn();
    const deps = baseDeps({
      loadDueJobs: async () => [
        {
          id: "j1",
          nextFireAt: new Date("2026-08-28T12:00:00Z"),
          inFlight: true,
          schedule: { kind: "interval", intervalMinutes: 10, timezone: "UTC" },
          prompt: "go",
          createdByUserId: "u1",
          companyId: "c1",
        },
      ],
      insertRun,
    });
    const result = await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);
    expect(insertRun).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["j1"]);
    expect(result.mode).toBe("idle");
  });

  it("skips a fire while the previous run awaits input, logs it and moves the schedule", async () => {
    const insertRun = vi.fn();
    const bumpNextFireAt = vi.fn(async () => {});
    const logPausedSkip = vi.fn(async () => {});
    const deps = baseDeps({
      loadDueJobs: async () => [
        { ...due("j1"), inFlight: true, pausedRunId: "run-paused" },
      ],
      insertRun,
      bumpNextFireAt,
      logPausedSkip,
    });
    const result = await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);
    expect(insertRun).not.toHaveBeenCalled();
    expect(logPausedSkip).toHaveBeenCalledWith(
      "j1",
      "run-paused",
      new Date("2026-08-28T12:00:00Z"),
    );
    expect(bumpNextFireAt).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual(["j1"]);
  });

  it("does not move the schedule while the previous run is still running", async () => {
    const bumpNextFireAt = vi.fn(async () => {});
    const logPausedSkip = vi.fn(async () => {});
    const deps = baseDeps({
      loadDueJobs: async () => [{ ...due("j1"), inFlight: true }],
      bumpNextFireAt,
      logPausedSkip,
    });
    await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);
    expect(bumpNextFireAt).not.toHaveBeenCalled();
    expect(logPausedSkip).not.toHaveBeenCalled();
  });

  it("starts batch when two jobs are due", async () => {
    const startBatch = vi.fn();
    const startLive = vi.fn();
    const deps = baseDeps({
      loadDueJobs: async () => [due("j1"), due("j2")],
      startBatch,
      startLive,
    });
    const result = await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);
    expect(startBatch).toHaveBeenCalledOnce();
    expect(startLive).not.toHaveBeenCalled();
    expect(result.mode).toBe("batch");
  });

  it("releases the lock before starting runs", async () => {
    const order: string[] = [];
    const startLive = vi.fn(async () => {
      order.push("startLive");
    });
    const deps = baseDeps({
      unlock: async () => {
        order.push("unlock");
      },
      startLive,
      loadDueJobs: async () => [due("j1")],
    });

    await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);

    expect(order).toEqual(["unlock", "startLive"]);
  });

  it("inserts failed run when creator is missing without starting execution", async () => {
    const insertRun = vi.fn(async () => "run-failed");
    const savePromptMessage = vi.fn();
    const startLive = vi.fn();
    const startBatch = vi.fn();
    const deps = baseDeps({
      loadDueJobs: async () => [
        {
          ...due("j1"),
          createdByUserId: null,
        },
      ],
      insertRun,
      savePromptMessage,
      startLive,
      startBatch,
    });
    const result = await runCronTick(new Date("2026-08-28T12:00:00Z"), deps);
    expect(insertRun).toHaveBeenCalledWith(
      "j1",
      new Date("2026-08-28T12:00:00Z"),
      new Date("2026-08-28T12:00:00Z"),
      { status: "failed", error: "creator missing" },
    );
    expect(savePromptMessage).not.toHaveBeenCalled();
    expect(startLive).not.toHaveBeenCalled();
    expect(startBatch).not.toHaveBeenCalled();
    expect(result.started).toEqual([]);
    expect(result.mode).toBe("idle");
  });

  it("records a failed run and advances the schedule when rate limited", async () => {
    const insertRun = vi.fn(async () => "run-limited");
    const bumpNextFireAt = vi.fn(async () => {});
    const savePromptMessage = vi.fn();
    const startLive = vi.fn();
    const checkRunLimit = vi.fn(async (job: { id: string }) =>
      job.id === "j1" ? "rate limited: cron.run.company.hour" : null,
    );
    const deps = baseDeps({
      loadDueJobs: async () => [due("j1"), due("j2")],
      insertRun,
      bumpNextFireAt,
      savePromptMessage,
      startLive,
      checkRunLimit,
    });
    const now = new Date("2026-08-28T12:00:00Z");
    const result = await runCronTick(now, deps);

    expect(checkRunLimit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "j1", companyId: "c1" }),
      now,
    );
    expect(insertRun).toHaveBeenCalledWith("j1", now, now, {
      status: "failed",
      error: "rate limited: cron.run.company.hour",
    });
    expect(bumpNextFireAt).toHaveBeenCalledTimes(2);
    expect(savePromptMessage).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual(["j1"]);
    expect(result.mode).toBe("live");
    expect(startLive).toHaveBeenCalledWith(["run-limited"]);
  });
});
