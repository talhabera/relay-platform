export async function proxyToWorker(body: unknown): Promise<Response> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error(
      "Worker unavailable: set WORKER_URL and WORKER_SECRET in the repo-root .env, then run `pnpm dev` (web + worker).",
    );
    return new Response("Worker unavailable", { status: 503 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  } catch {
    return new Response("Worker unreachable", { status: 502 });
  }
}

export type InboundNotification = {
  platform: "whatsapp" | "instagram";
  chatId: string;
  channelId: string;
};

/**
 * Ask the worker to answer an inbound message. The worker replies 202 and runs
 * the agent in the background, so this returns in milliseconds and the webhook
 * can still answer Meta well inside its retry window.
 *
 * Never throws. A failure here must not become a non-200 for Meta: the message
 * is already stored, and a redelivery would be dropped by the unique index
 * without producing the reply we failed to trigger.
 */
export async function notifyWorkerInbound(
  body: InboundNotification,
): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error(
      "[Inbound] worker unavailable: set WORKER_URL and WORKER_SECRET",
    );
    return false;
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/inbound`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[Inbound] worker rejected the notification", res.status);
      return false;
    }
    return true;
  } catch (cause) {
    console.error("[Inbound] worker unreachable", cause);
    return false;
  }
}

export type CommentNotification = {
  channelId: string;
  /** Our `instagram_comments` row id, not the Instagram comment id. */
  commentId: string;
};

/**
 * Ask the worker to answer an Instagram comment. The worker replies 202 and
 * runs the agent in the background, so this returns in milliseconds and the
 * webhook can still answer Meta well inside its retry window.
 *
 * Never throws. A failure here must not become a non-200 for Meta: the comment
 * is already stored, and a redelivery would be dropped by the insert's
 * `returning()` guard without producing the reply we failed to trigger.
 */
export async function notifyWorkerComment(
  body: CommentNotification,
): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error(
      "[Comment] worker unavailable: set WORKER_URL and WORKER_SECRET",
    );
    return false;
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/comment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[Comment] worker rejected the notification", res.status);
      return false;
    }
    return true;
  } catch (cause) {
    console.error("[Comment] worker unreachable", cause);
    return false;
  }
}

export type LeadDeliveryOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Ask the worker to run an approved `lead_delivery` card: the WhatsApp send
 * lives there. Waits for the send, so the caller can settle the card. Never
 * throws; every failure comes back as `{ ok: false }`.
 */
export async function deliverLeadOnWorker(
  checkpointId: string,
): Promise<LeadDeliveryOutcome> {
  return runCheckpointOnWorker("/internal/lead-delivery", checkpointId);
}

/**
 * Ask the worker to send an approved email `outreach` card from the
 * company's Gmail (S73). Same contract as `deliverLeadOnWorker`.
 */
export async function sendOutreachOnWorker(
  checkpointId: string,
): Promise<LeadDeliveryOutcome> {
  return runCheckpointOnWorker("/internal/outreach-send", checkpointId);
}

/**
 * Ask the worker to run an approved `ad_change` card (08b2): part a's
 * `applyAdChange` as the approving person, with the card's attempt. Same
 * contract as `deliverLeadOnWorker`; a cap refusal or a failed change comes
 * back as `{ ok: false }` with Turkish text for the failed card.
 */
export async function adChangeOnWorker(
  checkpointId: string,
): Promise<LeadDeliveryOutcome> {
  return runCheckpointOnWorker("/internal/ad-change", checkpointId);
}

async function runCheckpointOnWorker(
  path: "/internal/lead-delivery" | "/internal/outreach-send" | "/internal/ad-change",
  checkpointId: string,
): Promise<LeadDeliveryOutcome> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    return { ok: false, error: "Worker unavailable" };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ checkpointId }),
    });
    const body = (await res.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!res.ok) {
      const error =
        typeof body?.error === "string"
          ? body.error
          : `Worker answered ${res.status}`;
      return { ok: false, error };
    }
    return { ok: true, result: body ?? {} };
  } catch {
    return { ok: false, error: "Worker unreachable" };
  }
}

/**
 * Ask the worker to send the qualified-lead WhatsApp notification (lead
 * scoring spec, decision 16) after a person accepts a borderline lead. The
 * send lives in the worker. Never throws: a failed notification must not fail
 * the accept, and the `notified_at` claim makes a retry safe.
 */
export async function notifyQualifiedLeadOnWorker(leadId: string): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return false;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/lead-notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ leadId }),
    });
    return res.ok;
  } catch (cause) {
    console.error("[Lead notify] worker unreachable", cause);
    return false;
  }
}

/**
 * Ask the worker to send a person's handoff message (quick-link answer "as the
 * person", or a takeover message) out on the conversation's channel. The row
 * is already stored, which is the whole delivery for the widget. Never
 * throws: the message is saved either way, and the worker never sends a row
 * twice.
 */
export async function deliverHumanMessageOnWorker(messageId: string): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return false;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/handoff/deliver`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId }),
    });
    return res.ok;
  } catch (cause) {
    console.error("[Handoff] worker unreachable for delivery", cause);
    return false;
  }
}

/**
 * Ask the worker to follow up after a colleague answered with "let the agent
 * phrase it" (spec decision 5): the agent writes the reply in its own voice
 * right away. Never throws: the answer is stored either way, and the worker
 * follows up at most once per request.
 */
export async function requestHandoffFollowUpOnWorker(requestId: string): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return false;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/handoff/follow-up`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId }),
    });
    return res.ok;
  } catch (cause) {
    console.error("[Handoff] worker unreachable for follow-up", cause);
    return false;
  }
}

export type HandoffRecipientReply = {
  phoneNumberId: string;
  fromWaId: string;
  payload: string;
};

/**
 * Forward a recipient's Confirm tap to the worker, which checks the sender
 * number and the number on file before confirming. Never throws: the webhook
 * answers Meta 200 either way, and a lost tap is fixed by tapping again or
 * re-saving the number.
 */
export async function forwardHandoffRecipientReply(
  reply: HandoffRecipientReply,
): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error("[Handoff] worker unavailable for recipient reply");
    return false;
  }

  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/internal/handoff/recipient-reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reply),
      },
    );
    return res.ok;
  } catch (cause) {
    console.error("[Handoff] worker unreachable for recipient reply", cause);
    return false;
  }
}

/**
 * What became of the one-time confirmation message after a recipient number
 * was saved. `sent` = the worker accepted it (202); `not_needed` = the worker
 * found nothing to confirm or no company sender (409); `not_found` (404);
 * `failed` = WhatsApp refused the send (502) or any other worker answer;
 * `unavailable` = the worker could not be reached or is not configured.
 */
export type RecipientConfirmationOutcome =
  | "sent"
  | "not_needed"
  | "not_found"
  | "failed"
  | "unavailable";

/**
 * Ask the worker to send the recipient confirmation for a newly saved number.
 * Never throws: the settings are saved either way, and the outcome is only
 * reported back to the UI.
 */
export async function requestRecipientConfirmationOnWorker(input: {
  agentId: string;
  companyId: string;
}): Promise<RecipientConfirmationOutcome> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return "unavailable";

  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/internal/handoff/recipient-confirmation`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: input.agentId, companyId: input.companyId }),
      },
    );
    if (res.status === 202) return "sent";
    if (res.status === 409) return "not_needed";
    if (res.status === 404) return "not_found";
    return "failed";
  } catch (cause) {
    console.error("[Handoff] worker unreachable for recipient confirmation", cause);
    return "unavailable";
  }
}

async function postWorkerJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown } | null> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (cause) {
    console.error("[TeamChat] worker unreachable", path, cause);
    return null;
  }
}

/** Whether Team chat can be chosen (an Official Business Account sender). Never throws. */
export type TeamChatAvailabilityOutcome =
  | { available: true }
  | { available: false; reason: "needs_oba" | "no_sender" | "not_found" | "unavailable" };

export async function checkTeamChatAvailabilityOnWorker(input: {
  agentId: string;
  companyId: string;
}): Promise<TeamChatAvailabilityOutcome> {
  const res = await postWorkerJson("/internal/handoff/team-chat-availability", input);
  if (!res) return { available: false, reason: "unavailable" };
  if (res.status === 404) return { available: false, reason: "not_found" };
  const json = res.json as { available?: unknown; reason?: unknown } | null;
  if (res.status === 200 && json?.available === true) return { available: true };
  if (json?.reason === "needs_oba" || json?.reason === "no_sender") {
    return { available: false, reason: json.reason };
  }
  return { available: false, reason: "unavailable" };
}

/** The agent's Team chat group, created once on the worker. Never throws. */
export type TeamChatGroupOutcome =
  | { status: "active"; inviteLink: string | null }
  | { status: "pending" | "needs_oba" | "no_sender" | "not_found" | "failed" | "unavailable" };

export async function ensureTeamChatGroupOnWorker(input: {
  agentId: string;
  companyId: string;
}): Promise<TeamChatGroupOutcome> {
  const res = await postWorkerJson("/internal/handoff/team-chat-group", input);
  const json = res?.json as { status?: unknown; inviteLink?: unknown } | null | undefined;
  switch (json?.status) {
    case "active":
      return {
        status: "active",
        inviteLink: typeof json.inviteLink === "string" ? json.inviteLink : null,
      };
    case "pending":
    case "needs_oba":
    case "no_sender":
    case "not_found":
    case "failed":
      return { status: json.status };
    default:
      return { status: "unavailable" };
  }
}

/**
 * Forward a verified WhatsApp webhook body carrying Groups traffic (handoff
 * Team chat: group messages, `group_lifecycle_update`) to the worker, which
 * parses it itself. Never throws: the webhook answers Meta 200 either way.
 */
export async function forwardWhatsAppGroupWebhook(rawBody: string): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error("[TeamChat] worker unavailable for group webhook");
    return false;
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/whatsapp/groups`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });
    return res.ok;
  } catch (cause) {
    console.error("[TeamChat] worker unreachable for group webhook", cause);
    return false;
  }
}

/**
 * Whether the worker is still running a turn for this operator session. A page
 * load mid-turn uses it to show "running" instead of a stalled transcript.
 * Never throws; an unreachable worker reads as not running.
 */
export async function isWorkerRunActive(chatId: string): Promise<boolean> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return false;
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/internal/chat/running?chatId=${encodeURIComponent(chatId)}`,
      { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { running?: boolean };
    return body.running === true;
  } catch {
    return false;
  }
}
