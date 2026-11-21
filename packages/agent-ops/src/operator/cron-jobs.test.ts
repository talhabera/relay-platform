import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { computeNextFireAt } from "@relay/db/cron-schedule";
import {
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "../auth/access";
import {
  createCronJob,
  CronRunNowError,
  deleteCronJob,
  listCronJobs,
  runCronJobNow,
  updateCronJob,
} from "./cron-jobs";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agentVersions: { findFirst: vi.fn() },
        cronJobs: { findFirst: vi.fn(), findMany: vi.fn() },
        cronRuns: { findFirst: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyMembership: vi.fn(),
  requireOperatorAgentAccess: vi.fn(),
  requireOperatorAgentEdit: vi.fn(),
}));

vi.mock("@relay/db/cron-schedule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db/cron-schedule")>();
  return {
    ...actual,
    computeNextFireAt: vi.fn(() => new Date("2026-08-29T09:00:00.000Z")),
  };
});

const userId = "user-1";
const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const versionId = "770e8400-e29b-41d4-a716-446655440002";
const jobId = "990e8400-e29b-41d4-a716-446655440004";

describe("listCronJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      userId,
      company: { id: companyId },
    } as never);
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId },
    } as never);
  });

  it("lists jobs for a company when companyId is provided", async () => {
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([
      { id: jobId, name: "Sync" },
    ] as never);

    const jobs = await listCronJobs(userId, { companyId });

    expect(requireCompanyMembership).toHaveBeenCalledWith(userId, companyId);
    expect(jobs).toHaveLength(1);
  });

  it("lists jobs for an agent when agentId is provided", async () => {
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([
      { id: jobId, name: "Sync", agentId },
    ] as never);

    const jobs = await listCronJobs(userId, { agentId });

    expect(requireOperatorAgentAccess).toHaveBeenCalledWith(userId, agentId);
    expect(jobs).toHaveLength(1);
  });
});

describe("createCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId, kind: "operator" },
    } as never);
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
      id: versionId,
      agentId,
    } as never);
  });

  it("creates a job with computed nextFireAt", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: jobId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createCronJob(userId, {
      agentId,
      versionId,
      name: "Sync",
      prompt: "Go",
      scheduleKind: "interval",
      intervalMinutes: 30,
      timezone: "UTC",
    });

    expect(computeNextFireAt).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        agentId,
        versionId,
        nextFireAt: new Date("2026-08-29T09:00:00.000Z"),
        createdByUserId: userId,
      }),
    );
    expect(result).toEqual({ id: jobId });
  });

  it("rejects customer agents", async () => {
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId, kind: "customer" },
    } as never);

    await expect(
      createCronJob(userId, {
        agentId,
        versionId,
        name: "Sync",
        prompt: "Go",
        scheduleKind: "interval",
        intervalMinutes: 30,
      }),
    ).rejects.toThrow("not an operator agent");
  });
});

describe("updateCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId, kind: "operator" },
    } as never);
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue({
      id: jobId,
      agentId,
      companyId,
      scheduleKind: "interval",
      intervalMinutes: 30,
      weekday: null,
      timeOfDay: null,
      timezone: "UTC",
      nextFireAt: new Date("2026-08-29T08:00:00.000Z"),
    } as never);
  });

  it("refuses to turn on a package Schedule waiting for connectors", async () => {
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue({
      id: jobId,
      agentId,
      companyId,
      scheduleKind: "daily",
      intervalMinutes: null,
      weekday: null,
      timeOfDay: 600,
      timezone: "UTC",
      enabled: false,
      pausedReason: "waiting_for_connectors",
      packageSlug: "social-media",
      nextFireAt: new Date("2026-08-29T08:00:00.000Z"),
    } as never);

    await expect(updateCronJob(userId, jobId, { enabled: true })).rejects.toThrow(
      "Waiting for connectors",
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("recomputes nextFireAt when schedule changes", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    await updateCronJob(userId, jobId, {
      scheduleKind: "interval",
      intervalMinutes: 60,
    });

    expect(computeNextFireAt).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMinutes: 60,
        nextFireAt: new Date("2026-08-29T09:00:00.000Z"),
      }),
    );
  });
});

describe("deleteCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId, kind: "operator" },
    } as never);
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue({
      id: jobId,
      agentId,
    } as never);
  });

  it("deletes the cron job", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    await deleteCronJob(userId, jobId);

    expect(where).toHaveBeenCalled();
  });
});

describe("runCronJobNow", () => {
  const editableJob = {
    id: jobId,
    agentId,
    companyId,
    enabled: true,
    pausedReason: null,
    nextFireAt: new Date("2026-08-29T08:00:00.000Z"),
  };

  function mockUpdate() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);
    return { set, where };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent: { id: agentId, companyId, kind: "operator" },
    } as never);
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue(editableJob as never);
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue(undefined);
  });

  it("lets an editor queue the job by setting only nextFireAt to now", async () => {
    const { set, where } = mockUpdate();
    const before = Date.now();

    await runCronJobNow(userId, jobId);

    const after = Date.now();
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith(userId, agentId);
    expect(set).toHaveBeenCalledTimes(1);
    const written = (set.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(written)).toEqual(["nextFireAt"]);
    const nextFireAt = written.nextFireAt as Date;
    expect(nextFireAt).toBeInstanceOf(Date);
    expect(nextFireAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(nextFireAt.getTime()).toBeLessThanOrEqual(after);
    expect(where).toHaveBeenCalledTimes(1);
    expect(computeNextFireAt).not.toHaveBeenCalled();
  });

  it("refuses a user without edit access", async () => {
    mockUpdate();
    vi.mocked(requireOperatorAgentEdit).mockRejectedValue(
      new Error("Unauthorized: You don't have edit access to this operator agent"),
    );

    await expect(runCronJobNow(userId, jobId)).rejects.toThrow("edit access");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a missing job", async () => {
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue(undefined);

    await expect(runCronJobNow(userId, jobId)).rejects.toThrow("Cron job not found");
    expect(requireOperatorAgentEdit).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a disabled job", async () => {
    vi.mocked(db.query.cronJobs.findFirst).mockResolvedValue({
      ...editableJob,
      enabled: false,
    } as never);

    const run = runCronJobNow(userId, jobId);
    await expect(run).rejects.toBeInstanceOf(CronRunNowError);
    await expect(run).rejects.toThrow("Schedule is paused");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a job with a paused run waiting on input", async () => {
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue({
      id: "run-paused",
    } as never);

    const run = runCronJobNow(userId, jobId);
    await expect(run).rejects.toBeInstanceOf(CronRunNowError);
    await expect(run).rejects.toThrow("waiting on you");
    expect(db.query.cronRuns.findFirst).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });
});
