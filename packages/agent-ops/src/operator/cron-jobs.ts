import { and, eq } from "drizzle-orm";
import { agentVersions, cronJobs, cronRuns, db } from "@relay/db";
import { computeNextFireAt } from "@relay/db/cron-schedule";
import {
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "../auth/access";
import {
  buildCronSchedule,
  createCronJobSchema,
  updateCronJobSchema,
  validateCronScheduleFields,
} from "./schemas";

/** A Run now refusal whose message is safe to show the user. */
export class CronRunNowError extends Error {
  constructor(
    message: string,
    readonly code: "disabled" | "paused_run",
  ) {
    super(message);
    this.name = "CronRunNowError";
  }
}

async function requireCronJobEdit(userId: string, jobId: string) {
  const job = await db.query.cronJobs.findFirst({
    where: eq(cronJobs.id, jobId),
  });

  if (!job) {
    throw new Error("Cron job not found");
  }

  const access = await requireOperatorAgentEdit(userId, job.agentId);

  return { job, ...access };
}

export async function listCronJobs(
  userId: string,
  filters: { companyId?: string; agentId?: string },
) {
  if (filters.agentId) {
    await requireOperatorAgentAccess(userId, filters.agentId);

    return db.query.cronJobs.findMany({
      where: eq(cronJobs.agentId, filters.agentId),
      orderBy: (jobs, { asc }) => [asc(jobs.name)],
    });
  }

  if (filters.companyId) {
    await requireCompanyMembership(userId, filters.companyId);

    return db.query.cronJobs.findMany({
      where: eq(cronJobs.companyId, filters.companyId),
      orderBy: (jobs, { asc }) => [asc(jobs.name)],
    });
  }

  throw new Error("companyId or agentId is required");
}

export async function createCronJob(
  userId: string,
  data: Parameters<typeof createCronJobSchema.parse>[0],
) {
  const parsed = createCronJobSchema.parse(data);
  const { agent } = await requireOperatorAgentEdit(userId, parsed.agentId);

  if (agent.kind !== "operator") {
    throw new Error("Unauthorized: This agent is not an operator agent");
  }

  const version = await db.query.agentVersions.findFirst({
    where: and(
      eq(agentVersions.id, parsed.versionId),
      eq(agentVersions.agentId, parsed.agentId),
    ),
  });

  if (!version) {
    throw new Error("Version not found");
  }

  const schedule = buildCronSchedule(parsed);
  const nextFireAt = computeNextFireAt(schedule, new Date());

  const [job] = await db
    .insert(cronJobs)
    .values({
      companyId: agent.companyId,
      agentId: parsed.agentId,
      versionId: parsed.versionId,
      name: parsed.name,
      prompt: parsed.prompt,
      scheduleKind: parsed.scheduleKind,
      intervalMinutes:
        parsed.scheduleKind === "interval" ? parsed.intervalMinutes : null,
      weekday: parsed.scheduleKind === "weekly" ? parsed.weekday : null,
      timeOfDay:
        parsed.scheduleKind === "daily" || parsed.scheduleKind === "weekly"
          ? parsed.timeOfDay
          : null,
      timezone: parsed.timezone,
      enabled: parsed.enabled,
      nextFireAt,
      createdByUserId: userId,
    })
    .returning({ id: cronJobs.id });

  return { id: job.id };
}

export async function updateCronJob(
  userId: string,
  jobId: string,
  data: Omit<Parameters<typeof updateCronJobSchema.parse>[0], "jobId">,
) {
  const { job } = await requireCronJobEdit(userId, jobId);
  const parsed = updateCronJobSchema.parse({ ...data, jobId });

  // Packages spec decision 6: a package Schedule waiting for a required
  // connector resumes on its own once the connector connects, not by hand.
  if (parsed.enabled === true && job.pausedReason === "waiting_for_connectors") {
    throw new Error("Waiting for connectors: connect the required connectors first");
  }

  if (parsed.versionId) {
    const version = await db.query.agentVersions.findFirst({
      where: and(
        eq(agentVersions.id, parsed.versionId),
        eq(agentVersions.agentId, job.agentId),
      ),
    });

    if (!version) {
      throw new Error("Version not found");
    }
  }

  const scheduleKind = parsed.scheduleKind ?? job.scheduleKind;
  const scheduleInput = {
    scheduleKind,
    intervalMinutes:
      parsed.intervalMinutes ??
      (scheduleKind === "interval" ? job.intervalMinutes ?? undefined : undefined),
    weekday:
      parsed.weekday ??
      (scheduleKind === "weekly" ? job.weekday ?? undefined : undefined),
    timeOfDay:
      parsed.timeOfDay ??
      (scheduleKind === "daily" || scheduleKind === "weekly"
        ? job.timeOfDay ?? undefined
        : undefined),
    timezone: parsed.timezone ?? job.timezone,
  };

  validateCronScheduleFields(scheduleInput);

  const schedule = buildCronSchedule(scheduleInput);
  const scheduleChanged =
    (parsed.scheduleKind !== undefined &&
      parsed.scheduleKind !== job.scheduleKind) ||
    (parsed.intervalMinutes !== undefined &&
      parsed.intervalMinutes !== job.intervalMinutes) ||
    (parsed.weekday !== undefined && parsed.weekday !== job.weekday) ||
    (parsed.timeOfDay !== undefined && parsed.timeOfDay !== job.timeOfDay) ||
    (parsed.timezone !== undefined && parsed.timezone !== job.timezone);
  // A paused job's nextFireAt goes stale (the tick skips disabled jobs), so a
  // resume starts from the next slot instead of firing at once for the slot
  // it missed while paused.
  const resuming = parsed.enabled === true && !job.enabled;
  const recompute = scheduleChanged || resuming;
  const nextFireAt = recompute
    ? computeNextFireAt(schedule, new Date())
    : job.nextFireAt;

  await db
    .update(cronJobs)
    .set({
      ...(parsed.versionId !== undefined ? { versionId: parsed.versionId } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.prompt !== undefined ? { prompt: parsed.prompt } : {}),
      ...(parsed.scheduleKind !== undefined
        ? { scheduleKind: parsed.scheduleKind }
        : {}),
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
      intervalMinutes:
        scheduleKind === "interval" ? scheduleInput.intervalMinutes ?? null : null,
      weekday: scheduleKind === "weekly" ? scheduleInput.weekday ?? null : null,
      timeOfDay:
        scheduleKind === "daily" || scheduleKind === "weekly"
          ? scheduleInput.timeOfDay ?? null
          : null,
      ...(recompute ? { nextFireAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cronJobs.id, jobId));
}

export async function deleteCronJob(userId: string, jobId: string) {
  const { job } = await requireCronJobEdit(userId, jobId);

  await db.delete(cronJobs).where(eq(cronJobs.id, job.id));
}

/**
 * Queues a Schedule for the next cron tick by moving `nextFireAt` to now. The
 * tick fires it and then restores the regular slot, so nothing else changes.
 */
export async function runCronJobNow(userId: string, jobId: string) {
  const { job } = await requireCronJobEdit(userId, jobId);

  if (!job.enabled) {
    throw new CronRunNowError(
      "Schedule is paused: turn it on before running it now",
      "disabled",
    );
  }

  // The tick skips a job whose run is waiting on input and moves it to the
  // next slot, so a Run now here would be logged as a skip and never run.
  const pausedRun = await db.query.cronRuns.findFirst({
    where: and(eq(cronRuns.jobId, job.id), eq(cronRuns.status, "awaiting_input")),
    columns: { id: true },
  });

  if (pausedRun) {
    throw new CronRunNowError(
      "A run of this schedule is waiting on you: answer it in Sessions before running it again",
      "paused_run",
    );
  }

  await db
    .update(cronJobs)
    .set({ nextFireAt: new Date() })
    .where(eq(cronJobs.id, job.id));
}
