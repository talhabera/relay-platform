import { normalizeWhatsAppNumber, type WhatsAppSenderCredentials } from "../integrations/whatsapp";
import {
  createWhatsAppStaffChannel,
  type StaffDelivery,
  type StaffNotificationChannel,
} from "./staff-channel";
import {
  findStaffSender,
  getCompanyName,
  markHandoffNotified,
} from "./staff-store";
import type { HandoffRequestRow } from "./store";
import { postTeamChatQuestion, type TeamChatPostOutcome } from "./team-chat";

export type HandoffNotification = {
  request: HandoffRequestRow;
  /** Raw quick-link token. Never log it. Null for Team chat. */
  token: string | null;
};

/**
 * Why a request stayed Inbox-only. The Inbox is always the fallback, so none
 * of these is an error the customer sees.
 */
export type HandoffNotifyOutcome =
  | { notified: true; delivery: Extract<StaffDelivery, { status: "sent" }> }
  | { notified: true; teamChat: Extract<TeamChatPostOutcome, { posted: true }> }
  | {
      notified: false;
      reason:
        | "no_recipient"
        | "no_sender"
        | "failed"
        // Team chat: the agent has no active group, or the sender is not an
        // Official Business Account. No 1:1 fallback.
        | "no_group"
        | "needs_oba";
      error?: string;
    };

export type HandoffNotifier = (
  notification: HandoffNotification,
) => Promise<HandoffNotifyOutcome | void>;

export interface HandoffNotifierDeps {
  findSender: (
    companyId: string,
    agentId: string | null,
  ) => Promise<WhatsAppSenderCredentials | null>;
  companyName: (companyId: string) => Promise<string | null>;
  channelFor: (sender: WhatsAppSenderCredentials) => StaffNotificationChannel;
  markNotified: (
    requestId: string,
    at: Date,
    providerMessageId: string | null,
  ) => Promise<void>;
  postTeamChat: (request: HandoffRequestRow) => Promise<TeamChatPostOutcome>;
  now: () => Date;
}

const defaultDeps: HandoffNotifierDeps = {
  findSender: findStaffSender,
  companyName: getCompanyName,
  channelFor: createWhatsAppStaffChannel,
  markNotified: markHandoffNotified,
  // Lazy: team-chat.ts sits on an import cycle through follow-up.ts.
  postTeamChat: (request) => postTeamChatQuestion(request),
  now: () => new Date(),
};

/**
 * Reach the primary recipient with the quick link: a WhatsApp template from
 * the company's own sender. `request.recipientWhatsapp` is set only when the
 * recipient had confirmed (see `openOrAppendHandoffRequest`), so an
 * unconfirmed recipient is never messaged. Team chat posts the question in
 * the agent's WhatsApp group instead (`team-chat.ts`).
 */
export function createHandoffNotifier(
  overrides: Partial<HandoffNotifierDeps> = {},
): (notification: HandoffNotification) => Promise<HandoffNotifyOutcome> {
  const deps = { ...defaultDeps, ...overrides };

  return async ({ request, token }) => {
    if (request.mode === "team_chat") {
      const posted = await deps.postTeamChat(request);
      return posted.posted
        ? { notified: true, teamChat: posted }
        : { notified: false, reason: posted.reason, error: posted.error };
    }

    const to = normalizeWhatsAppNumber(request.recipientWhatsapp);
    if (!to || !token) {
      console.info("[Handoff] request opened, Inbox only", request.id);
      return { notified: false, reason: "no_recipient" };
    }

    const sender = await deps.findSender(request.companyId, request.agentId);
    if (!sender) {
      console.warn("[Handoff] company has no WhatsApp sender", request.id);
      return { notified: false, reason: "no_sender" };
    }

    const delivery = await deps.channelFor(sender).sendHandoffRequest({
      to,
      recipientName: request.recipientName,
      companyName: (await deps.companyName(request.companyId)) ?? "your company",
      question: request.questions[0]?.text ?? request.reason,
      token,
    });

    if (delivery.status === "failed") {
      console.error("[Handoff] notification failed", request.id, delivery.error);
      return { notified: false, reason: "failed", error: delivery.error };
    }

    await deps.markNotified(request.id, deps.now(), delivery.providerMessageId);
    console.info(
      "[Handoff] recipient notified",
      request.id,
      delivery.channel,
      delivery.providerMessageId,
    );
    return { notified: true, delivery };
  };
}

export const notifyHandoffRecipient: HandoffNotifier = createHandoffNotifier();
