import { normalizeWhatsAppNumber, type WhatsAppSenderCredentials } from "../integrations/whatsapp";
import {
  createWhatsAppStaffChannel,
  type StaffDelivery,
  type StaffNotificationChannel,
} from "./staff-channel";
import {
  confirmRecipient,
  findStaffSender,
  getCompanyName,
  getHandoffSettingsRow,
  isCompanySender,
} from "./staff-store";
import type { HandoffSettingsRow } from "./store";

/**
 * Recipient confirmation (spec decision 7). Saving a new number sends a
 * one-time WhatsApp message; until the recipient taps Confirm, the Handoff
 * node shows "Recipient not confirmed" and requests go straight to the Inbox.
 */

export type RecipientConfirmationState =
  /** Team chat has no primary recipient. */
  | "not_needed"
  | "no_recipient"
  /** The Handoff node's "Recipient not confirmed". */
  | "not_confirmed"
  | "confirmed";

export function recipientConfirmationState(
  settings: Pick<HandoffSettingsRow, "mode" | "recipientWhatsapp" | "recipientConfirmed">,
): RecipientConfirmationState {
  if (settings.mode === "team_chat") return "not_needed";
  if (!settings.recipientWhatsapp) return "no_recipient";
  return settings.recipientConfirmed ? "confirmed" : "not_confirmed";
}

const PAYLOAD_PREFIX = "handoff_confirm:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function confirmationPayload(agentId: string): string {
  return `${PAYLOAD_PREFIX}${agentId}`;
}

/** The agent id from a Confirm button payload, or null for any other reply. */
export function parseConfirmationPayload(payload: string | null | undefined): string | null {
  if (!payload?.startsWith(PAYLOAD_PREFIX)) return null;
  const agentId = payload.slice(PAYLOAD_PREFIX.length);
  return UUID.test(agentId) ? agentId : null;
}

export interface RecipientConfirmationDeps {
  getSettings: (agentId: string) => Promise<HandoffSettingsRow | null>;
  findSender: (
    companyId: string,
    agentId: string | null,
  ) => Promise<WhatsAppSenderCredentials | null>;
  companyName: (companyId: string) => Promise<string | null>;
  channelFor: (sender: WhatsAppSenderCredentials) => StaffNotificationChannel;
  isCompanySender: (phoneNumberId: string, companyId: string) => Promise<boolean>;
  confirm: typeof confirmRecipient;
  now: () => Date;
}

const defaultDeps: RecipientConfirmationDeps = {
  getSettings: getHandoffSettingsRow,
  findSender: findStaffSender,
  companyName: getCompanyName,
  channelFor: createWhatsAppStaffChannel,
  isCompanySender,
  confirm: confirmRecipient,
  now: () => new Date(),
};

export type SendConfirmationResult =
  | { status: "sent"; delivery: Extract<StaffDelivery, { status: "sent" }> }
  | {
      status:
        | "not_found"
        | "not_needed"
        | "no_recipient"
        | "already_confirmed"
        | "no_sender";
    }
  | { status: "failed"; error: string };

/**
 * Send the one-time "Confirm you'll receive handoff requests for Acme"
 * message. `companyId` scopes the call: an agent of another company reads as
 * not found.
 */
export async function sendRecipientConfirmation(
  agent: { id: string; companyId: string },
  overrides: Partial<RecipientConfirmationDeps> = {},
): Promise<SendConfirmationResult> {
  const deps = { ...defaultDeps, ...overrides };
  const settings = await deps.getSettings(agent.id);
  if (!settings || settings.companyId !== agent.companyId) return { status: "not_found" };

  const state = recipientConfirmationState(settings);
  if (state !== "not_confirmed") {
    return { status: state === "confirmed" ? "already_confirmed" : state };
  }
  const to = normalizeWhatsAppNumber(settings.recipientWhatsapp);
  if (!to) return { status: "no_recipient" };

  const sender = await deps.findSender(settings.companyId, settings.agentId);
  if (!sender) return { status: "no_sender" };

  const delivery = await deps.channelFor(sender).sendRecipientConfirmation({
    to,
    recipientName: settings.recipientName,
    companyName: (await deps.companyName(settings.companyId)) ?? "your company",
    confirmPayload: confirmationPayload(settings.agentId),
  });
  if (delivery.status === "failed") {
    console.error("[Handoff] confirmation send failed", settings.agentId, delivery.error);
    return { status: "failed", error: delivery.error };
  }
  console.info(
    "[Handoff] confirmation sent",
    settings.agentId,
    delivery.providerMessageId,
  );
  return { status: "sent", delivery };
}

export type RecipientReply = {
  /** The company sender the reply arrived on (webhook `metadata.phone_number_id`). */
  phoneNumberId: string;
  /** The replying number (webhook `messages[].from`). */
  fromWaId: string;
  /** The tapped button's payload. */
  payload: string | null | undefined;
};

/**
 * A tap on Confirm. It counts only when it arrives on the company's own
 * sender, from the number currently on file. Anything else is ignored, so a
 * stale button after a number change, or a forged payload, confirms nothing.
 */
export async function confirmHandoffRecipient(
  reply: RecipientReply,
  overrides: Partial<RecipientConfirmationDeps> = {},
): Promise<"confirmed" | "ignored"> {
  const deps = { ...defaultDeps, ...overrides };
  const agentId = parseConfirmationPayload(reply.payload);
  if (!agentId) return "ignored";

  const settings = await deps.getSettings(agentId);
  if (!settings?.recipientWhatsapp || settings.recipientConfirmed) return "ignored";
  if (settings.mode === "team_chat") return "ignored";

  const onFile = normalizeWhatsAppNumber(settings.recipientWhatsapp);
  if (!onFile || onFile !== normalizeWhatsAppNumber(reply.fromWaId)) return "ignored";
  if (!(await deps.isCompanySender(reply.phoneNumberId, settings.companyId))) {
    return "ignored";
  }

  const confirmed = await deps.confirm({
    agentId,
    companyId: settings.companyId,
    recipientWhatsapp: settings.recipientWhatsapp,
    now: deps.now(),
  });
  return confirmed ? "confirmed" : "ignored";
}

export type InternalResponse = { status: number; body: string };

const STATUS_FOR_SEND: Record<SendConfirmationResult["status"], number> = {
  sent: 202,
  not_found: 404,
  not_needed: 409,
  no_recipient: 409,
  already_confirmed: 409,
  no_sender: 409,
  failed: 502,
};

/**
 * `POST /internal/handoff/recipient-confirmation {agentId, companyId}`: the
 * web app calls this after saving a new recipient number.
 */
export async function handleRecipientConfirmationRequest(
  body: unknown,
  overrides: Partial<RecipientConfirmationDeps> = {},
): Promise<InternalResponse> {
  const { agentId, companyId } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof agentId !== "string" ||
    typeof companyId !== "string" ||
    !UUID.test(agentId) ||
    !UUID.test(companyId)
  ) {
    return { status: 400, body: "Invalid confirmation request" };
  }
  const result = await sendRecipientConfirmation({ id: agentId, companyId }, overrides);
  return { status: STATUS_FOR_SEND[result.status], body: result.status };
}

/**
 * `POST /internal/handoff/recipient-reply {phoneNumberId, fromWaId, payload}`:
 * the WhatsApp webhook forwards a button reply whose payload is a
 * confirmation payload, instead of treating it as a customer message.
 */
export async function handleRecipientReply(
  body: unknown,
  overrides: Partial<RecipientConfirmationDeps> = {},
): Promise<InternalResponse> {
  const { phoneNumberId, fromWaId, payload } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof phoneNumberId !== "string" ||
    typeof fromWaId !== "string" ||
    typeof payload !== "string"
  ) {
    return { status: 400, body: "Invalid recipient reply" };
  }
  const outcome = await confirmHandoffRecipient(
    { phoneNumberId, fromWaId, payload },
    overrides,
  );
  return { status: 200, body: outcome };
}
