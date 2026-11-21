"use server";

import { revalidatePath } from "next/cache";
import {
  listCronJobs as listCronJobsOp,
  createCronJob as createCronJobOp,
  updateCronJob as updateCronJobOp,
  deleteCronJob as deleteCronJobOp,
  runCronJobNow as runCronJobNowOp,
  CronRunNowError,
} from "@relay/agent-ops";
import { requireSession } from "@/lib/auth-server";
import type { z } from "zod";
import {
  createCronJobSchema,
  updateCronJobSchema,
} from "@/lib/validators/cron";

export async function listCronJobs(companyId: string) {
  const session = await requireSession();
  return listCronJobsOp(session.user.id, { companyId });
}

export async function createCronJob(
  data: z.input<typeof createCronJobSchema>,
) {
  const session = await requireSession();
  const result = await createCronJobOp(session.user.id, data);
  revalidatePath("/operator");
  return result;
}

export async function updateCronJob(
  jobId: string,
  data: Omit<Parameters<typeof updateCronJobSchema.parse>[0], "jobId">,
) {
  const session = await requireSession();
  await updateCronJobOp(session.user.id, jobId, data);
  revalidatePath("/operator");
}

export async function deleteCronJob(jobId: string) {
  const session = await requireSession();
  await deleteCronJobOp(session.user.id, jobId);
  revalidatePath("/operator");
}

export type RunCronJobNowResult = { ok: true } | { error: string };

/**
 * Queues the Schedule for the next cron tick. A refusal (paused Schedule, run
 * waiting on input) comes back as `{ error }` so the client sees the message.
 */
export async function runCronJobNowAction(
  jobId: string,
): Promise<RunCronJobNowResult> {
  const session = await requireSession();
  try {
    await runCronJobNowOp(session.user.id, jobId);
  } catch (error) {
    if (error instanceof CronRunNowError) return { error: error.message };
    throw error;
  }
  revalidatePath("/operator");
  return { ok: true };
}
