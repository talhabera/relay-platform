"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { KOLEVA_FUNNEL_STATUSES, SALE_PACKAGES } from "@/db/schema";
import { requireLeadSession } from "@/lib/leads/session-access";
import {
  acceptBorderlineLead,
  addLeadPayment,
  excludeLead,
  LEAD_PAYMENT_KINDS,
  moveLeadStatus,
  rejectBorderlineLead,
  removeLeadPayment,
} from "@/lib/leads";

// Leads work pane actions (lead scoring spec decision 6). Gate: membership +
// steer gate on the session's agent; the company comes from the session, and
// every status change goes through lib/leads -> transitionLeadStatus, so each
// one lands in lead_events with the person as actor. `move` walks the Koleva
// funnel; `payment_add` / `payment_remove` record cash received on a won lead
// (one lead at a time, audited in lead_events too).

const leadActionSchema = z
  .object({
    chatId: z.string().uuid(),
    action: z.enum(["accept", "reject", "exclude", "move", "payment_add", "payment_remove"]),
    leadIds: z.array(z.string().uuid()).min(1).max(100),
    reason: z.string().trim().max(200).optional(),
    toStatus: z.enum(KOLEVA_FUNNEL_STATUSES).optional(),
    salePackage: z.enum(SALE_PACKAGES).optional(),
    saleAmountMinor: z.number().finite().optional(),
    reopen: z.boolean().optional(),
    kind: z.enum(LEAD_PAYMENT_KINDS).optional(),
    amountMinor: z.number().finite().optional(),
    receivedOn: z.string().max(10).optional(),
    paymentId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.action !== "move" || v.toStatus !== undefined, {
    message: "move needs toStatus",
    path: ["toStatus"],
  })
  .refine(
    (v) =>
      v.action !== "payment_add" ||
      (v.kind !== undefined && v.amountMinor !== undefined && v.receivedOn !== undefined),
    { message: "payment_add needs kind, amountMinor and receivedOn", path: ["kind"] },
  )
  .refine((v) => v.action !== "payment_remove" || v.paymentId !== undefined, {
    message: "payment_remove needs paymentId",
    path: ["paymentId"],
  })
  .refine((v) => !v.action.startsWith("payment_") || v.leadIds.length === 1, {
    message: "payments are recorded one lead at a time",
    path: ["leadIds"],
  });

export type LeadActionInput = z.input<typeof leadActionSchema>;

export type LeadActionResult = {
  done: number;
  failed: number;
};

export async function applyLeadAction(input: LeadActionInput): Promise<LeadActionResult> {
  const parsed = leadActionSchema.parse(input);
  const { chatId, action, leadIds, reason } = parsed;
  const access = await requireLeadSession(chatId);
  const base = { companyId: access.window.companyId, userId: access.userId };

  let done = 0;
  for (const leadId of new Set(leadIds)) {
    let result: { ok: boolean };
    if (action === "accept") result = await acceptBorderlineLead({ ...base, leadId });
    else if (action === "reject") result = await rejectBorderlineLead({ ...base, leadId, reason });
    else if (action === "exclude") result = await excludeLead({ ...base, leadId, reason });
    else if (action === "move") {
      result = await moveLeadStatus({
        ...base,
        leadId,
        toStatus: parsed.toStatus!,
        salePackage: parsed.salePackage,
        saleAmountMinor: parsed.saleAmountMinor,
        reason,
        reopen: parsed.reopen,
      });
    } else if (action === "payment_add") {
      result = await addLeadPayment({
        ...base,
        leadId,
        kind: parsed.kind!,
        amountMinor: parsed.amountMinor!,
        receivedOn: parsed.receivedOn!,
      });
    } else {
      result = await removeLeadPayment({ ...base, leadId, paymentId: parsed.paymentId! });
    }
    if (result.ok) done++;
  }

  revalidatePath("/operator");
  return { done, failed: new Set(leadIds).size - done };
}
