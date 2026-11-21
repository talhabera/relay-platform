import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  chats,
  checkpointArtifactHash,
  companies,
  companyRecords,
  db,
  checkpoints,
  deriveSessionStatus,
  type CompanyRecordStatus,
  type LeadDeliveryPayload,
  type OutreachPayload,
  transitionLeadStatus,
} from "@relay/db";
import { formatLeadNotification } from "../leads/notify-lead";
import { getCompanyRecord } from "./company-records";

const MAX_BODY_LENGTH = 8000;
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const CRON_FOLLOW_UP_CAP = 10;
const BLOCKED: CompanyRecordStatus[] = ["pending", "processing", "failed"];
const ALREADY_PENDING = "Outreach already waiting for Send";

type OutreachChannel = "email" | "whatsapp" | "copy";

export async function proposeOutreach(opts: {
  companyId: string;
  agentId: string;
  chatId?: string;
  cronRunId?: string;
  input: {
    recordId: string;
    actionType: "outreach";
    channel: OutreachChannel;
    recipient: string;
    subject?: string;
    body: string;
    reason: string;
    force?: boolean;
  };
}): Promise<
  | {
      status: "pending_approval";
      pendingId: string;
      kind: "action";
      actionType: "outreach";
      toolName: "proposeAction";
      channel: OutreachChannel;
      recipient: string;
      subject?: string;
      body: string;
      reason: string;
      recordName: string;
      message: "Wait for Send or Reject.";
    }
  | { error: string }
> {
  const hasChat = Boolean(opts.chatId);
  const hasCron = Boolean(opts.cronRunId);
  if (hasChat === hasCron) {
    return { error: "Parent session missing" };
  }

  if (opts.input.body.length > MAX_BODY_LENGTH) {
    return { error: "Message is too long" };
  }

  if (opts.input.channel === "email" && !opts.input.subject?.trim()) {
    return { error: "Email subject is required" };
  }

  const record = await getCompanyRecord({
    companyId: opts.companyId,
    recordId: opts.input.recordId,
  });
  if ("error" in record) {
    return { error: "Not found" };
  }

  if (BLOCKED.includes(record.status)) {
    return { error: "Research this account first" };
  }

  const existingPending = await db.query.checkpoints.findFirst({
    where: and(
      eq(checkpoints.recordId, opts.input.recordId),
      eq(checkpoints.status, "pending"),
      eq(checkpoints.kind, "outreach"),
    ),
  });
  if (existingPending) {
    return { error: ALREADY_PENDING };
  }

  const force = hasCron ? false : Boolean(opts.input.force);
  const latestApproved = await db.query.checkpoints.findFirst({
    where: and(
      eq(checkpoints.recordId, opts.input.recordId),
      eq(checkpoints.status, "approved"),
    ),
    orderBy: (row, { desc }) => [desc(row.resolvedAt)],
  });
  if (
    !force &&
    latestApproved?.resolvedAt &&
    Date.now() - latestApproved.resolvedAt.getTime() <= COOLDOWN_MS
  ) {
    return { error: "Last approved outreach is within 3 days" };
  }

  if (hasCron) {
    const runActions = await db.query.checkpoints.findMany({
      where: eq(checkpoints.cronRunId, opts.cronRunId!),
    });
    if (runActions.length >= CRON_FOLLOW_UP_CAP) {
      return { error: "Follow-up cap of 10 for this run" };
    }
  }

  const payload: OutreachPayload = {
    kind: "outreach",
    channel: opts.input.channel,
    recipient: opts.input.recipient,
    subject: opts.input.subject,
    body: opts.input.body,
    reason: opts.input.reason,
    recordName: record.name,
    domain: record.domain,
  };

  const [pending] = await db
    .insert(checkpoints)
    .values({
      companyId: opts.companyId,
      agentId: opts.agentId,
      chatId: opts.chatId ?? null,
      cronRunId: opts.cronRunId ?? null,
      recordId: opts.input.recordId,
      kind: "outreach",
      status: "pending",
      endpointSnapshot: null,
      payload,
      artifactHash: checkpointArtifactHash(payload),
    })
    // checkpoints_record_pending_uidx: a concurrent propose for the same
    // record that got past the read above lands here and inserts nothing.
    .onConflictDoNothing({
      target: checkpoints.recordId,
      where: sql`"status" = 'pending' AND "record_id" IS NOT NULL`,
    })
    .returning({ id: checkpoints.id });

  if (!pending) {
    return { error: ALREADY_PENDING };
  }

  await transitionLeadStatus(db, {
    companyId: opts.companyId,
    recordId: record.id,
    toStatus: "outreach_pending",
    actor: { agentId: opts.agentId },
  });

  await supersedeEarlierCards({
    newId: pending.id,
    recordId: record.id,
    chatId: opts.chatId,
    cronRunId: opts.cronRunId,
  });

  if (opts.chatId) {
    // A fresh pending card is open, so the session needs a person.
    await db
      .update(chats)
      .set({
        status: deriveSessionStatus({
          running: false,
          failed: false,
          openCheckpoints: 1,
          openQuestions: 0,
        }),
        lastActivityAt: new Date(),
      })
      .where(eq(chats.id, opts.chatId));
  }

  return {
    status: "pending_approval",
    pendingId: pending.id,
    kind: "action",
    actionType: "outreach",
    toolName: "proposeAction",
    channel: opts.input.channel,
    recipient: opts.input.recipient,
    ...(opts.input.subject !== undefined ? { subject: opts.input.subject } : {}),
    body: opts.input.body,
    reason: opts.input.reason,
    recordName: record.name,
    message: "Wait for Send or Reject.",
  };
}

/**
 * Ask for changes and Refresh lead the agent to post a new card; the card it
 * replaces (same parent, same record, `changes_requested` or `stale`) points
 * at the new one through `supersededBy` and stays as history.
 */
async function supersedeEarlierCards(args: {
  newId: string;
  recordId: string;
  chatId?: string;
  cronRunId?: string;
}) {
  const parent = args.chatId
    ? eq(checkpoints.chatId, args.chatId)
    : eq(checkpoints.cronRunId, args.cronRunId!);
  await db
    .update(checkpoints)
    .set({ supersededBy: args.newId })
    .where(
      and(
        parent,
        eq(checkpoints.kind, "outreach"),
        eq(checkpoints.recordId, args.recordId),
        inArray(checkpoints.status, ["changes_requested", "stale"]),
        isNull(checkpoints.supersededBy),
        ne(checkpoints.id, args.newId),
      ),
    );
}

export type LeadDeliveryParent = { chatId: string } | { cronRunId: string };

export type ProposeLeadDeliveryResult =
  | { proposed: true; pendingId: string }
  | {
      proposed: false;
      reason:
        | "not_found"
        | "delivered"
        | "not_qualified"
        | "no_recipient"
        | "no_parent"
        | "already_pending";
    };

/**
 * Proposes the deliver-to-client card for a qualified inbound lead (lead
 * scoring spec, decision 15; W3GAP). Called by the runtime, not a tool: when
 * Qualify routes a lead to `deliver`, when a person accepts an inbound
 * borderline lead, and when a legacy inbound agent's checklist completes.
 *
 * The card sends the lead's summary to the company's lead WhatsApp number once
 * a person approves it. A lead already `delivered` gets no card. One pending
 * card per record (checkpoints_record_pending_uidx): a second call while one
 * is open inserts nothing. The lead's status does not move here; approval
 * moves it to `delivered` (markLeadDelivered in the web app).
 *
 * The parent is the session or run that qualified the lead; with none (a
 * person's accept, a customer conversation) it is the lead's own chat.
 */
export async function proposeLeadDelivery(opts: {
  companyId: string;
  recordId: string;
  /** The agent credited with the card; the lead's source agent when absent. */
  agentId?: string;
  parent?: LeadDeliveryParent;
}): Promise<ProposeLeadDeliveryResult> {
  const record = await db.query.companyRecords.findFirst({
    where: and(
      eq(companyRecords.id, opts.recordId),
      eq(companyRecords.companyId, opts.companyId),
    ),
  });
  if (!record) return { proposed: false, reason: "not_found" };
  if (record.status === "delivered") return { proposed: false, reason: "delivered" };
  if (record.status !== "qualified") return { proposed: false, reason: "not_qualified" };

  const parent: LeadDeliveryParent | null =
    opts.parent ?? (record.chatId ? { chatId: record.chatId } : null);
  const agentId = opts.agentId ?? record.sourceAgentId;
  if (!parent || !agentId) return { proposed: false, reason: "no_parent" };

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, opts.companyId),
  });
  const recipient = company?.leadNotifyWhatsapp?.trim();
  if (!recipient) return { proposed: false, reason: "no_recipient" };

  const payload: LeadDeliveryPayload = {
    kind: "lead_delivery",
    leadId: record.id,
    channel: "whatsapp",
    recipient,
    summary: formatLeadNotification(record),
    reason:
      record.score !== null
        ? `Qualified inbound lead, fit ${record.score}`
        : "Qualified inbound lead",
  };

  const [pending] = await db
    .insert(checkpoints)
    .values({
      companyId: opts.companyId,
      agentId,
      chatId: "chatId" in parent ? parent.chatId : null,
      cronRunId: "cronRunId" in parent ? parent.cronRunId : null,
      recordId: record.id,
      kind: "lead_delivery",
      status: "pending",
      endpointSnapshot: null,
      payload,
      artifactHash: checkpointArtifactHash(payload),
    })
    .onConflictDoNothing({
      target: checkpoints.recordId,
      where: sql`"status" = 'pending' AND "record_id" IS NOT NULL`,
    })
    .returning({ id: checkpoints.id });

  if (!pending) return { proposed: false, reason: "already_pending" };
  return { proposed: true, pendingId: pending.id };
}
