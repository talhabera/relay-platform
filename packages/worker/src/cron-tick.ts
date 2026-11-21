import { and, eq, inArray, lte } from "drizzle-orm";
import postgres from "postgres";
import {
  RATE_LIMIT_SURFACES,
  enforceRateLimits,
  createPgRateLimitStore,
} from "@relay/db/rate-limit";
import {
  computeNextFireAt,
  cronJobs,
  cronRunMessages,
  cronRuns,
  db as defaultDb,
  type CronRunStatus,
  type CronSchedule,
  type IntervalMinutes,
} from "@relay/db";

type Db = typeof defaultDb;

export type DueJob = { id: string; nextFireAt: Date };

export type TickDeps = {
  tryLock: () => Promise<boolean>;
  unlock: () => Promise<void>;
  loadDueJobs: (
    now: Date,
  ) => Promise<
    Array<
      DueJob & {
        inFlight: boolean;
        /** The in-flight run waiting on a person (awaiting_input), if any. */
        pausedRunId?: string | null;
        schedule: CronSchedule;
        prompt: string;
        createdByUserId: string | null;
        companyId: string;
      }
    >
  >;
  /**
   * Per-job and per-company run caps. Returns null when the run may start,
   * otherwise the reason it was refused (stored on the failed run).
   */
  checkRunLimit: (
    job: { id: string; companyId: string },
    now: Date,
  ) => Promise<string | null>;
  insertRun: (
    jobId: string,
    fireAt: Date,
    now: Date,
    options?: { status: "failed"; error: string },
  ) => Promise<string>;
  savePromptMessage: (runId: string, prompt: string) => Promise<void>;
  bumpNextFireAt: (jobId: string, next: Date) => Promise<void>;
  /** Record a fire skipped because the previous run is paused. */
  logPausedSkip?: (
    jobId: string,
    pausedRunId: string,
    fireAt: Date,
  ) => Promise<void>;
  startLive: (runIds: string[]) => Promise<void>;
  startBatch: (runIds: string[]) => Promise<void>;
};

export function partitionMode(dueCount: number): "live" | "batch" {
  return dueCount === 1 ? "live" : "batch";
}

export function isInFlightStatus(status: CronRunStatus): boolean {
  return status === "running" || status === "awaiting_input";
}

export async function runCronTick(
  now: Date,
  deps: TickDeps,
): Promise<{ started: string[]; skipped: string[]; mode: "live" | "batch" | "idle" }> {
  const locked = await deps.tryLock();
  if (!locked) {
    return { started: [], skipped: [], mode: "idle" };
  }

  const started: string[] = [];
  const skipped: string[] = [];

  try {
    const jobs = await deps.loadDueJobs(now);

    for (const job of jobs) {
      const nextFireAt = computeNextFireAt(job.schedule, now);

      if (job.inFlight) {
        // No auto-expiry (checkpoints spec decision 6): a paused run can wait
        // for days, so this fire is skipped, logged, and the schedule moves on.
        if (job.pausedRunId) {
          await deps.logPausedSkip?.(job.id, job.pausedRunId, job.nextFireAt);
          await deps.bumpNextFireAt(job.id, nextFireAt);
        }
        skipped.push(job.id);
        continue;
      }

      if (job.createdByUserId === null) {
        await deps.insertRun(job.id, job.nextFireAt, now, {
          status: "failed",
          error: "creator missing",
        });
        await deps.bumpNextFireAt(job.id, nextFireAt);
        continue;
      }

      const refused = await deps.checkRunLimit(job, now);
      if (refused) {
        await deps.insertRun(job.id, job.nextFireAt, now, {
          status: "failed",
          error: refused,
        });
        await deps.bumpNextFireAt(job.id, nextFireAt);
        skipped.push(job.id);
        continue;
      }

      const runId = await deps.insertRun(job.id, job.nextFireAt, now);
      await deps.savePromptMessage(runId, job.prompt);
      await deps.bumpNextFireAt(job.id, nextFireAt);
      started.push(runId);
    }
  } finally {
    await deps.unlock();
  }

  if (started.length === 1) {
    await deps.startLive(started);
  } else if (started.length >= 2) {
    await deps.startBatch(started);
  }

  const mode =
    started.length === 0
      ? "idle"
      : started.length === 1
        ? "live"
        : "batch";

  return { started, skipped, mode };
}

type CronJobRow = typeof cronJobs.$inferSelect;

function jobToSchedule(job: CronJobRow): CronSchedule {
  switch (job.scheduleKind) {
    case "interval":
      return {
        kind: "interval",
        intervalMinutes: job.intervalMinutes as IntervalMinutes,
        timezone: job.timezone,
      };
    case "daily":
      return {
        kind: "daily",
        timeOfDay: job.timeOfDay!,
        timezone: job.timezone,
      };
    case "weekly":
      return {
        kind: "weekly",
        weekday: job.weekday!,
        timeOfDay: job.timeOfDay!,
        timezone: job.timezone,
      };
  }
}

let lockClient: ReturnType<typeof postgres> | null = null;

function getLockClient(): ReturnType<typeof postgres> {
  if (!lockClient) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    lockClient = postgres(connectionString, { max: 1 });
  }
  return lockClient;
}

export function createPgTickDeps(
  db: Db,
  runners?: {
    startLive?: (runIds: string[]) => Promise<void>;
    startBatch?: (runIds: string[]) => Promise<void>;
  },
): TickDeps {
  const startLive = runners?.startLive ?? (async () => {});
  const startBatch = runners?.startBatch ?? (async () => {});
  const lockConn = getLockClient();
  const rateLimitStore = createPgRateLimitStore(db);

  return {
    tryLock: async () => {
      const result = await lockConn<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(hashtext('relay-cron-tick')) as locked
      `;
      return result[0]?.locked === true;
    },
    unlock: async () => {
      await lockConn`SELECT pg_advisory_unlock(hashtext('relay-cron-tick'))`;
    },
    loadDueJobs: async (now) => {
      const rows = await db
        .select()
        .from(cronJobs)
        .where(and(eq(cronJobs.enabled, true), lte(cronJobs.nextFireAt, now)));

      const due = [];
      for (const row of rows) {
        const inflight = await db
          .select({ id: cronRuns.id, status: cronRuns.status })
          .from(cronRuns)
          .where(
            and(
              eq(cronRuns.jobId, row.id),
              inArray(cronRuns.status, ["running", "awaiting_input"]),
            ),
          )
          .limit(1);

        due.push({
          id: row.id,
          nextFireAt: row.nextFireAt,
          inFlight: inflight.length > 0,
          pausedRunId:
            inflight[0]?.status === "awaiting_input" ? inflight[0].id : null,
          schedule: jobToSchedule(row),
          prompt: row.prompt,
          createdByUserId: row.createdByUserId,
          companyId: row.companyId,
        });
      }
      return due;
    },
    checkRunLimit: async (job, now) => {
      // enforceRateLimits applies the company's own Settings limits.
      const result = await enforceRateLimits(
        rateLimitStore,
        RATE_LIMIT_SURFACES.cronRun({ companyId: job.companyId, jobId: job.id }),
        { now },
      );
      if (result.ok) return null;
      const { denial } = result;
      if (denial.kind !== "rate") return `rate limited: ${denial.policy}`;
      return `rate limited: ${denial.policy} allows ${denial.limit} runs per ${denial.windowSec / 60} minutes`;
    },
    insertRun: async (jobId, fireAt, now, options) => {
      const failed = options?.status === "failed";
      const [row] = await db
        .insert(cronRuns)
        .values({
          jobId,
          status: failed ? "failed" : "running",
          fireAt,
          startedAt: failed ? null : now,
          finishedAt: failed ? now : null,
          error: failed ? options.error : null,
        })
        .returning({ id: cronRuns.id });
      return row!.id;
    },
    savePromptMessage: async (runId, prompt) => {
      await db.insert(cronRunMessages).values({
        runId,
        content: prompt,
        role: "user",
      });
    },
    bumpNextFireAt: async (jobId, next) => {
      await db
        .update(cronJobs)
        .set({ nextFireAt: next, updatedAt: new Date() })
        .where(eq(cronJobs.id, jobId));
    },
    logPausedSkip: async (jobId, pausedRunId, fireAt) => {
      console.info("[cron] skipped fire: previous run awaiting input", {
        jobId,
        pausedRunId,
        fireAt: fireAt.toISOString(),
      });
      // System rows stay out of the model history (cronRunMessagesToUIMessages
      // reads user, assistant and tool only) but show on the run's log.
      await db.insert(cronRunMessages).values({
        runId: pausedRunId,
        role: "system",
        content: `Skipped the ${fireAt.toISOString()} run: previous run awaiting input.`,
      });
    },
    startLive: async (runIds) => {
      await startLive(runIds);
    },
    startBatch: async (runIds) => {
      await startBatch(runIds);
    },
  };
}
