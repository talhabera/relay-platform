import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentVersions,
  cronJobs,
  db,
  packageInstalls,
  workflows,
  workflowStages,
} from "@relay/db";
import { requireCompanyAccess } from "../auth/access";
import {
  installPackage,
  PackageInstallError,
  resumeWaitingPackageSchedules,
} from "./packages";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: { select: vi.fn(), transaction: vi.fn() },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyAccess: vi.fn(),
}));

const userId = "user-1";
const companyId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-05T12:00:00Z");

type Row = Record<string, unknown>;

/** Records inserts and updates; `returning` hands back rows with fake ids. */
function fakeTx(opts: { installConflict?: boolean } = {}) {
  const inserts: { table: unknown; rows: Row[] }[] = [];
  const updates: { table: unknown; set: Row }[] = [];
  let seq = 0;
  const tx = {
    insert(table: unknown) {
      return {
        values(v: Row | Row[]) {
          const rows = Array.isArray(v) ? v : [v];
          inserts.push({ table, rows });
          const withIds = rows.map((r) => ({ ...r, id: `id-${++seq}` }));
          const result = {
            onConflictDoNothing: () => result,
            returning: async () =>
              table === packageInstalls && opts.installConflict ? [] : withIds,
          };
          return result;
        },
      };
    },
    update(table: unknown) {
      return {
        set(set: Row) {
          updates.push({ table, set });
          return {
            where: () => {
              const p = Promise.resolve(undefined) as Promise<unknown> & {
                returning: () => Promise<Row[]>;
              };
              p.returning = async () => [{ id: `upd-${++seq}` }];
              return p;
            },
          };
        },
      };
    },
  };
  const rowsOf = (table: unknown) =>
    inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
  return { tx, inserts, updates, rowsOf };
}

/** `db.select().from().where()` resolving to the queued results in order. */
function queueSelects(...results: Row[][]) {
  for (const result of results) {
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: async () => result }),
    } as never);
  }
}

function runTransactionWith(tx: unknown) {
  vi.mocked(db.transaction).mockImplementation((async (
    fn: (t: unknown) => unknown,
  ) => fn(tx)) as never);
}

describe("installPackage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId,
      company: { id: companyId, timezone: "Europe/Istanbul" },
    } as never);
  });

  it("is owner-only: a non-owner is refused before anything is written", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(
      new Error("Unauthorized: You don't have access to this company"),
    );
    await expect(installPackage(userId, companyId, "lead-engine", now)).rejects.toThrow(
      "Unauthorized",
    );
    expect(requireCompanyAccess).toHaveBeenCalledWith(userId, companyId);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses revenue and unknown slugs", async () => {
    await expect(installPackage(userId, companyId, "revenue", now)).rejects.toMatchObject({
      code: "unknown_slug",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("creates Lead engine in one transaction: 3 agents, 1 workflow, 3 running Schedules", async () => {
    queueSelects([]); // no connectors: Lead engine needs none
    const fake = fakeTx();
    runTransactionWith(fake.tx);

    const result = await installPackage(userId, companyId, "lead-engine", now);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(fake.rowsOf(packageInstalls)).toEqual([
      expect.objectContaining({
        companyId,
        packageSlug: "lead-engine",
        installedByUserId: userId,
        catalogVersion: 1,
      }),
    ]);
    const agentRows = fake.rowsOf(agents);
    expect(agentRows.map((a) => a.name)).toEqual([
      "Lead Gatherer",
      "Lead Qualifier",
      "Mail Marketer",
    ]);
    for (const a of agentRows) {
      expect(a).toMatchObject({ kind: "operator", packageSlug: "lead-engine" });
    }
    expect(fake.rowsOf(agentVersions)).toHaveLength(3);
    expect(fake.rowsOf(agentVersions).every((v) => v.status === "live")).toBe(true);

    const [wf] = fake.rowsOf(workflows);
    expect(wf).toMatchObject({
      packageSlug: "lead-engine",
      name: "Lead engine",
      weeklyTarget: 10,
      targetMetricKey: "leads.qualified_delivered",
    });
    expect((wf.intake as { key: string }[]).map((f) => f.key)).toContain("need");
    const stages = fake.rowsOf(workflowStages);
    expect(stages.map((s) => s.name)).toEqual([
      "Gather",
      "Qualify",
      "Outreach",
      "Delivered to client",
    ]);
    expect(stages[3].agentId).toBeNull();
    // Inbound points at Qualify.
    expect(fake.updates).toContainEqual(
      expect.objectContaining({ table: workflows, set: { inboundStageId: expect.any(String) } }),
    );

    const jobs = fake.rowsOf(cronJobs);
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job).toMatchObject({
        enabled: true,
        pausedReason: null,
        packageSlug: "lead-engine",
        timezone: "Europe/Istanbul",
      });
      expect(job.nextFireAt).toBeInstanceOf(Date);
    }
    expect(new Set(jobs.map((j) => j.agentId)).size).toBe(3);
    expect(result.waitingFor).toEqual([]);
    expect(result.agentIds).toHaveLength(3);
    expect(result.cronJobIds).toHaveLength(3);
  });

  it("pauses Social media Schedules 'Waiting for connectors' when a required connector is missing", async () => {
    queueSelects([{ type: "meta" }]);
    const fake = fakeTx();
    runTransactionWith(fake.tx);

    const result = await installPackage(userId, companyId, "social-media", now);

    expect(result.waitingFor).toEqual(["google_business_profile"]);
    const jobs = fake.rowsOf(cronJobs);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job).toMatchObject({
        enabled: false,
        pausedReason: "waiting_for_connectors",
        packageSlug: "social-media",
      });
    }
  });

  it("installs Insights with one weekly Schedule tagged insights", async () => {
    queueSelects([]);
    const fake = fakeTx();
    runTransactionWith(fake.tx);

    await installPackage(userId, companyId, "insights", now);

    const [job] = fake.rowsOf(cronJobs);
    expect(job).toMatchObject({
      packageSlug: "insights",
      scheduleKind: "weekly",
      weekday: 1,
      enabled: true,
    });
  });

  it("installs Daily manager with one unpaused daily Schedule tagged manager at 510", async () => {
    queueSelects([]); // built-in connectors only: nothing to wait for
    const fake = fakeTx();
    runTransactionWith(fake.tx);

    const result = await installPackage(userId, companyId, "manager", now);

    expect(result.waitingFor).toEqual([]);
    const jobs = fake.rowsOf(cronJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      packageSlug: "manager",
      name: "Morning brief",
      scheduleKind: "daily",
      timeOfDay: 510,
      enabled: true,
      pausedReason: null,
    });
    expect(jobs[0].nextFireAt).toBeInstanceOf(Date);
  });

  it("throws already_installed when the install row exists", async () => {
    queueSelects([]);
    const fake = fakeTx({ installConflict: true });
    runTransactionWith(fake.tx);

    const error = await installPackage(userId, companyId, "insights", now).catch((e) => e);
    expect(error).toBeInstanceOf(PackageInstallError);
    expect(error.code).toBe("already_installed");
    expect(fake.rowsOf(agents)).toHaveLength(0);
  });
});

describe("resumeWaitingPackageSchedules", () => {
  beforeEach(() => vi.resetAllMocks());

  const waitingJob = {
    id: "job-1",
    companyId,
    packageSlug: "social-media",
    pausedReason: "waiting_for_connectors",
    enabled: false,
    scheduleKind: "daily",
    timeOfDay: 600,
    weekday: null,
    intervalMinutes: null,
    timezone: "UTC",
  };

  it("does nothing while a required connector is still missing", async () => {
    queueSelects([waitingJob], [{ type: "meta" }]);
    expect(await resumeWaitingPackageSchedules(companyId, now)).toEqual([]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("resumes once the last required connector connects", async () => {
    queueSelects([waitingJob], [{ type: "meta" }, { type: "google_business_profile" }]);
    const fake = fakeTx();
    runTransactionWith(fake.tx);

    const resumed = await resumeWaitingPackageSchedules(companyId, now);

    expect(resumed).toHaveLength(1);
    expect(fake.updates).toEqual([
      {
        table: cronJobs,
        set: expect.objectContaining({
          enabled: true,
          pausedReason: null,
          nextFireAt: expect.any(Date),
        }),
      },
    ]);
  });

  it("returns early with no waiting Schedules", async () => {
    queueSelects([]);
    expect(await resumeWaitingPackageSchedules(companyId, now)).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
