import { and, eq, isNull, sql } from "drizzle-orm";
import {
  agents,
  channels,
  checkpoints,
  companyRecords,
  db,
  isDeliverableLeadStatus,
  type CheckpointSendReceipt,
  type LeadDeliveryPayload,
} from "@relay/db";
import { whatsappCredentials } from "../ai/channel-credentials";
import { sendMessage } from "../integrations/messaging";

// Runs an approved `lead_delivery` card (S26). The web app owns the card's
// state machine and the lead's status; it calls this over WORKER_URL because
// the WhatsApp send lives here. This only sends and reports what happened.
//
// At most once per card (W3GAP): `checkpoints.send_receipt` is claimed as
// `sending` before the send and settled as `sent` with its result. A repeat
// call (a stuck-approved Retry, or a Retry of the web's bookkeeping after a
// good send) gets the earlier result back and sends nothing. A send that
// failed clears the claim so Retry can send; a claim left `sending` (the
// worker died mid-send) is never re-sent automatically.

export type DeliverLeadResult =
  | {
      ok: true;
      result: {
        mode: "sent";
        channel: LeadDeliveryPayload["channel"];
        recipient: string;
        messageId: string | null;
      };
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 502; error: string };

export function parseDeliverLeadBody(body: unknown): { checkpointId: string } | null {
  const id = (body as { checkpointId?: unknown } | null)?.checkpointId;
  return typeof id === "string" && id.length > 0 ? { checkpointId: id } : null;
}

export async function deliverLead(checkpointId: string): Promise<DeliverLeadResult> {
  const card = await db.query.checkpoints.findFirst({
    where: eq(checkpoints.id, checkpointId),
  });
  if (!card) return { ok: false, status: 404, error: "Checkpoint not found" };
  if (card.payload.kind !== "lead_delivery") {
    return { ok: false, status: 400, error: "Not a lead delivery checkpoint" };
  }
  // Web claims the card (pending -> approved) before asking; anything else is
  // a stale or replayed request.
  if (card.status !== "approved") {
    return { ok: false, status: 409, error: `Checkpoint is ${card.status}` };
  }

  const receipt = card.sendReceipt;
  if (receipt?.state === "sent") {
    return { ok: true, result: receipt.result as SentResult };
  }
  if (receipt?.state === "sending") {
    return { ok: false, status: 409, error: DELIVERY_IN_FLIGHT };
  }

  const payload = card.payload;
  if (payload.channel !== "whatsapp") {
    return {
      ok: false,
      status: 422,
      error: `No connector can deliver a lead by ${payload.channel} yet`,
    };
  }

  const lead = await db.query.companyRecords.findFirst({
    where: and(
      eq(companyRecords.id, payload.leadId),
      eq(companyRecords.companyId, card.companyId),
    ),
  });
  if (!lead) return { ok: false, status: 404, error: "Lead not found" };
  if (!isDeliverableLeadStatus(lead.status)) {
    return {
      ok: false,
      status: 422,
      error: `Lead is ${lead.status}; only qualified or interested leads are delivered`,
    };
  }

  const channel = await findWhatsAppChannel(card.companyId, lead.sourceAgentId);
  const credentials = whatsappCredentials(channel?.config);
  if (!credentials) {
    return { ok: false, status: 422, error: "No active WhatsApp channel" };
  }

  const claimed = await writeReceipt(
    checkpointId,
    { state: "sending", at: new Date().toISOString() },
    isNull(checkpoints.sendReceipt),
  );
  if (!claimed) return { ok: false, status: 409, error: DELIVERY_IN_FLIGHT };

  const recipient = payload.recipient.replace(/^\+/, "");
  const sent = await sendMessage("whatsapp", recipient, payload.summary, credentials);
  if (!sent.success) {
    // Nothing went out: release the claim so Retry can send.
    await writeReceipt(checkpointId, null, SENDING);
    return { ok: false, status: 502, error: sent.error ?? "WhatsApp send failed" };
  }
  const result: SentResult = {
    mode: "sent",
    channel: payload.channel,
    recipient: payload.recipient,
    messageId: sent.messageId,
  };
  await writeReceipt(
    checkpointId,
    { state: "sent", at: new Date().toISOString(), result },
    SENDING,
  );
  return { ok: true, result };
}

type SentResult = Extract<DeliverLeadResult, { ok: true }>["result"];

const DELIVERY_IN_FLIGHT =
  "This delivery already started and may have reached the client; check before sending again";

const SENDING = sql`${checkpoints.sendReceipt}->>'state' = 'sending'`;

/** Guarded write of the card's send marker; true when it landed. */
async function writeReceipt(
  checkpointId: string,
  receipt: CheckpointSendReceipt | null,
  guard: ReturnType<typeof sql> | ReturnType<typeof isNull>,
): Promise<boolean> {
  const rows = await db
    .update(checkpoints)
    .set({ sendReceipt: receipt })
    .where(and(eq(checkpoints.id, checkpointId), eq(checkpoints.status, "approved"), guard))
    .returning({ id: checkpoints.id });
  return rows.length > 0;
}

/** The lead's own agent's WhatsApp number first, else any active one. */
async function findWhatsAppChannel(companyId: string, agentId: string | null) {
  if (agentId) {
    const own = await db.query.channels.findFirst({
      where: and(
        eq(channels.agentId, agentId),
        eq(channels.type, "whatsapp"),
        eq(channels.status, "active"),
      ),
    });
    if (own) return own;
  }
  const [any] = await db
    .select({ config: channels.config })
    .from(channels)
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(channels.type, "whatsapp"),
        eq(channels.status, "active"),
      ),
    )
    .limit(1);
  return any;
}
