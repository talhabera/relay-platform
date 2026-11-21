"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth-server";
import { setWeeklyTarget, type WeeklyTargetInput } from "./target";

/** Owner-only inline edit of a workflow's weekly target (Goal strip). */
export async function updateWeeklyTarget(input: WeeklyTargetInput) {
  const session = await requireSession();
  const result = await setWeeklyTarget(session.user.id, input);
  revalidatePath("/home");
  revalidatePath("/operator");
  return result;
}
