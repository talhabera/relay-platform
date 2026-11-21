"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { companyMembers, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { normalizeWhatsappNumber } from "@/lib/client/notifications";
import { requireClientAccess } from "@/lib/operator/access";

export type ProfileActionResult = { ok: true; value: string | null } | { ok: false; message: string };

/** Profile WhatsApp number (S107). Own profile only; stored as E.164. */
export async function saveWhatsappNumber(input: string): Promise<ProfileActionResult> {
  const session = await requireSession();
  const parsed = normalizeWhatsappNumber(z.string().max(40).parse(input));
  if (!parsed.ok) return parsed;
  await db
    .update(users)
    .set({ whatsappNumber: parsed.value, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/client/profile");
  return { ok: true, value: parsed.value };
}

const companyIdSchema = z.string().uuid();

/**
 * Report email opt-out under Notifications (spec client-role-and-portal,
 * decision 8). Client users only: the preview is read-only. S88 reads it.
 */
export async function setReportEmails(companyId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const id = companyIdSchema.parse(companyId);
  const on = z.boolean().parse(enabled);
  const { session } = await requireClientAccess(id, { mutation: true });
  await db
    .update(companyMembers)
    .set({ reportEmailOptOut: !on })
    .where(
      and(
        eq(companyMembers.companyId, id),
        eq(companyMembers.userId, session.user.id),
        eq(companyMembers.role, "client"),
      ),
    );
  revalidatePath("/client/profile/notifications");
  return { ok: true };
}

/** Opening the bell clears its dot. A no-op for the preview. */
export async function markNotificationsSeen(companyId: string): Promise<void> {
  const id = companyIdSchema.parse(companyId);
  const { session, role } = await requireClientAccess(id);
  if (role !== "client") return;
  await db
    .update(companyMembers)
    .set({ notificationsSeenAt: new Date() })
    .where(
      and(
        eq(companyMembers.companyId, id),
        eq(companyMembers.userId, session.user.id),
        eq(companyMembers.role, "client"),
      ),
    );
}
