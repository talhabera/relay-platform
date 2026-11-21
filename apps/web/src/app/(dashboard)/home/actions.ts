"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  addBriefItemAsTask as addBriefItemAsTaskOp,
  setBriefItemStatus as setBriefItemStatusOp,
} from "@relay/agent-ops";

import { db } from "@/db";
import { dailyBriefs } from "@/db/schema";
import { requireCompanyMembership } from "@/lib/operator/access";

const markBriefReadSchema = z.object({
  companyId: z.string().uuid(),
  briefId: z.string().uuid(),
});

/**
 * Home opened the Daily brief: sets `readAt` on that brief of the company, so
 * its Needs you item goes away. Any company member; a read brief stays read.
 */
export async function markBriefRead(input: { companyId: string; briefId: string }) {
  const { companyId, briefId } = markBriefReadSchema.parse(input);
  await requireCompanyMembership(companyId);

  await db
    .update(dailyBriefs)
    .set({ readAt: new Date() })
    .where(and(eq(dailyBriefs.id, briefId), eq(dailyBriefs.companyId, companyId), isNull(dailyBriefs.readAt)));

  revalidatePath("/home");
  revalidatePath("/needs-you");
  return { ok: true as const };
}

const briefItemSchema = z.object({
  companyId: z.string().uuid(),
  briefId: z.string().uuid(),
  rank: z.number().int(),
});

const setBriefItemStatusSchema = briefItemSchema.extend({
  status: z.enum(["open", "done", "dismissed"]),
});

const addBriefItemAsTaskSchema = briefItemSchema.extend({
  projectId: z.string().uuid().nullable().optional(),
});

/** Done / Dismiss (and back to open) on one Daily brief item; Done completes a linked task. */
export async function setBriefItemStatus(input: {
  companyId: string;
  briefId: string;
  rank: number;
  status: "open" | "done" | "dismissed";
}) {
  const parsed = setBriefItemStatusSchema.parse(input);
  const { session } = await requireCompanyMembership(parsed.companyId);
  await setBriefItemStatusOp(session.user.id, parsed);
  revalidatePath("/home");
  return { ok: true as const };
}

/** Creates a task from one Daily brief item and links it on the item. */
export async function addBriefItemAsTask(input: {
  companyId: string;
  briefId: string;
  rank: number;
  projectId?: string | null;
}) {
  const parsed = addBriefItemAsTaskSchema.parse(input);
  const { session } = await requireCompanyMembership(parsed.companyId);
  await addBriefItemAsTaskOp(session.user.id, parsed);
  revalidatePath("/home");
  return { ok: true as const };
}
