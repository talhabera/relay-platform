import {
  sendWhatsAppTemplate,
  type WhatsAppSenderCredentials,
} from "../integrations/whatsapp";

/**
 * How a person at the company is reached: the handoff request with its quick
 * link, and the one-time recipient confirmation. WhatsApp (Meta Cloud API,
 * the company's own sender) is the only live channel. SMS is a seam with the
 * same shape so a provider (Twilio) can be added without touching callers.
 */

export type StaffChannelKind = "whatsapp" | "sms";

/** "sent" means the provider accepted it; delivered/read arrive later by webhook. */
export type StaffDelivery =
  | { status: "sent"; channel: StaffChannelKind; providerMessageId: string }
  | { status: "failed"; channel: StaffChannelKind; error: string };

export interface HandoffRequestMessage {
  /** Normalized number: country code and digits. */
  to: string;
  recipientName: string | null;
  companyName: string;
  question: string;
  /** Raw quick-link token. Goes into the link only; never logged. */
  token: string;
}

export interface RecipientConfirmationMessage {
  to: string;
  recipientName: string | null;
  companyName: string;
  /** Echoed back by the Confirm button. */
  confirmPayload: string;
}

export interface StaffNotificationChannel {
  kind: StaffChannelKind;
  sendHandoffRequest(message: HandoffRequestMessage): Promise<StaffDelivery>;
  sendRecipientConfirmation(
    message: RecipientConfirmationMessage,
  ): Promise<StaffDelivery>;
}

/**
 * Utility templates each company's WhatsApp Business account must have
 * approved under these names:
 *
 * - `relay_handoff_request`: body "Hi {{1}}, a customer of {{2}} needs you:
 *   {{3}}", URL button "Open" -> `<app url>/h/{{1}}` (the token).
 * - `relay_handoff_recipient_confirm`: body "Hi {{1}}, confirm you'll receive
 *   handoff requests for {{2}}", quick-reply button "Confirm".
 */
export const HANDOFF_REQUEST_TEMPLATE = {
  name: "relay_handoff_request",
  language: "en",
} as const;
export const RECIPIENT_CONFIRM_TEMPLATE = {
  name: "relay_handoff_recipient_confirm",
  language: "en",
} as const;

const GREETING_FALLBACK = "there";

export function createWhatsAppStaffChannel(
  sender: WhatsAppSenderCredentials,
): StaffNotificationChannel {
  const toDelivery = (result: Awaited<ReturnType<typeof sendWhatsAppTemplate>>): StaffDelivery =>
    result.success
      ? { status: "sent", channel: "whatsapp", providerMessageId: result.messageId }
      : { status: "failed", channel: "whatsapp", error: result.error };

  return {
    kind: "whatsapp",
    async sendHandoffRequest(message) {
      return toDelivery(
        await sendWhatsAppTemplate(sender, message.to, {
          ...HANDOFF_REQUEST_TEMPLATE,
          bodyParams: [
            message.recipientName ?? GREETING_FALLBACK,
            message.companyName,
            message.question,
          ],
          urlButtonSuffix: message.token,
        }),
      );
    },
    async sendRecipientConfirmation(message) {
      return toDelivery(
        await sendWhatsAppTemplate(sender, message.to, {
          ...RECIPIENT_CONFIRM_TEMPLATE,
          bodyParams: [message.recipientName ?? GREETING_FALLBACK, message.companyName],
          quickReplyPayload: message.confirmPayload,
        }),
      );
    },
  };
}

/**
 * SMS seam. No provider is wired: every send fails, so the request stays in
 * the Inbox. A Twilio implementation replaces the two bodies and needs the
 * app's public URL to build the quick link (`/h/<token>`).
 */
export function createSmsStaffChannel(): StaffNotificationChannel {
  const unavailable = async (): Promise<StaffDelivery> => ({
    status: "failed",
    channel: "sms",
    error: "SMS notifications are not available",
  });
  return {
    kind: "sms",
    sendHandoffRequest: unavailable,
    sendRecipientConfirmation: unavailable,
  };
}
