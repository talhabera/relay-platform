import { and, eq, isNull, sql } from "drizzle-orm";
import {
  checkpoints,
  db,
  integrations,
  type CheckpointSendReceipt,
} from "@relay/db";
import {
  buildGmailRawMessage,
  googleOAuthClient,
  isSendableEmail,
  refreshGoogleAccessToken,
  sendGmailMessage,
} from "../integrations/google-workspace/gmail";

// Runs an approved email `outreach` card through the company's Google
// Workspace connector (S73). The web app owns the card's state machine and
// only asks when Gmail is connected; otherwise approve stays "copy and send
// yourself". This only sends and reports what happened.
//
// At most once per card, like lead delivery: `checkpoints.send_receipt` is
// claimed as `sending` before the send and settled as `sent`. A repeat call
// returns the earlier result; a failed send clears the claim so Retry can
// send; a claim left `sending` is never re-sent automatically.

export type SendOutreachResult =
  | {
      ok: true;
      result: {
        mode: "sent";
        channel: "email";
        provider: "gmail";
        from: string;
        recipient: string;
        subject?: string;
        messageId: string | null;
        threadId: string | null;
      };
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 502; error: string };

type SentResult = Extract<SendOutreachResult, { ok: true }>["result"];

export function parseSendOutreachBody(body: unknown): { checkpointId: string } | null {
  const id = (body as { checkpointId?: unknown } | null)?.checkpointId;
  return typeof id === "string" && id.length > 0 ? { checkpointId: id } : null;
}

export async function sendOutreach(
  checkpointId: string,
  options: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<SendOutreachResult> {
  const card = await db.query.checkpoints.findFirst({
    where: eq(checkpoints.id, checkpointId),
  });
  if (!card) return { ok: false, status: 404, error: "Checkpoint not found" };
  if (card.payload.kind !== "outreach") {
    return { ok: false, status: 400, error: "Not an outreach checkpoint" };
  }
  if (card.status !== "approved") {
    return { ok: false, status: 409, error: `Checkpoint is ${card.status}` };
  }

  const receipt = card.sendReceipt;
  if (receipt?.state === "sent") {
    return { ok: true, result: receipt.result as SentResult };
  }
  if (receipt?.state === "sending") {
    return { ok: false, status: 409, error: SEND_IN_FLIGHT };
  }

  const payload = card.payload;
  if (payload.channel !== "email") {
    return {
      ok: false,
      status: 422,
      error: `Gmail cannot send a ${payload.channel} outreach`,
    };
  }
  const recipient = payload.recipient.trim();
  if (!isSendableEmail(recipient)) {
    return { ok: false, status: 422, error: `"${recipient}" is not one email address` };
  }

  const connector = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, card.companyId),
      eq(integrations.type, "google_workspace"),
      isNull(integrations.agentId),
    ),
  });
  const gmail = connector?.config?.googleWorkspace;
  if (!connector || connector.status !== "connected" || !gmail?.refreshToken) {
    return { ok: false, status: 422, error: "Google Workspace is not connected" };
  }

  const client = googleOAuthClient(options.env);
  if (!client) {
    return { ok: false, status: 422, error: "Google sign-in is not configured" };
  }

  const token = await refreshGoogleAccessToken({
    client,
    refreshToken: gmail.refreshToken,
    fetchImpl: options.fetchImpl,
  });
  if (!token.ok) {
    if (token.revoked) {
      // Settings › Connectors shows the error row with Reconnect.
      await db
        .update(integrations)
        .set({ status: "error", error: token.error, updatedAt: new Date() })
        .where(eq(integrations.id, connector.id));
    }
    return { ok: false, status: token.revoked ? 422 : 502, error: token.error };
  }

  const claimed = await writeReceipt(
    checkpointId,
    { state: "sending", at: new Date().toISOString() },
    isNull(checkpoints.sendReceipt),
  );
  if (!claimed) return { ok: false, status: 409, error: SEND_IN_FLIGHT };

  const sent = await sendGmailMessage({
    accessToken: token.accessToken,
    raw: buildGmailRawMessage({
      from: gmail.email,
      to: recipient,
      subject: payload.subject ?? "",
      body: payload.body,
    }),
    fetchImpl: options.fetchImpl,
  });
  if (!sent.ok) {
    await writeReceipt(checkpointId, null, SENDING);
    return { ok: false, status: 502, error: sent.error };
  }

  const result: SentResult = {
    mode: "sent",
    channel: "email",
    provider: "gmail",
    from: gmail.email,
    recipient,
    ...(payload.subject ? { subject: payload.subject } : {}),
    messageId: sent.messageId,
    threadId: sent.threadId,
  };
  await writeReceipt(
    checkpointId,
    { state: "sent", at: new Date().toISOString(), result },
    SENDING,
  );
  return { ok: true, result };
}

const SEND_IN_FLIGHT =
  "This email already started sending and may have arrived; check Gmail's Sent folder before sending again";

const SENDING = sql`${checkpoints.sendReceipt}->>'state' = 'sending'`;

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
