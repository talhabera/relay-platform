import { eq } from "drizzle-orm";
import {
  chats,
  companies,
  companyRecords,
  db,
  type HandoffIfNobodyAnswers,
  type MessageMetadata,
} from "@relay/db";
import { saveAssistantMessage } from "../ai/chat-persistence";
import {
  expireDueHandoffRequests,
  getHandoffSettings,
  handBackIdleTakeovers,
  type HandoffRequestRow,
} from "./store";
import {
  findActiveChannel,
  isMessagingChannel,
  sendSavedMessageToCustomer,
} from "./deliver";

/** Metadata key marking the customer message sent when one request expired. */
export const HANDOFF_EXPIRED_KEY = "handoffExpiredRequestId" satisfies keyof MessageMetadata;

const EMAIL_PATTERN = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/i;

/** The email in a lead's contact field, if it holds one. */
export function capturedEmail(contact: string | null | undefined): string | null {
  const match = contact?.match(EMAIL_PATTERN);
  return match ? match[0] : null;
}

/** Intake keys that name an email field, checked before any other answer. */
const EMAIL_INTAKE_KEYS = ["email", "e_mail", "eposta", "e_posta"];

/**
 * The email captured on the conversation's lead: the intake answers that
 * `record_lead` writes into `company_records.payload.intake`. An email field
 * wins; otherwise the first answer that holds an email (the pilot client's `iletisim`).
 */
export function capturedEmailFromIntake(payload: unknown): string | null {
  const intake =
    payload && typeof payload === "object" ? (payload as { intake?: unknown }).intake : null;
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) return null;
  const answers = Object.entries(intake as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const ordered = [
    ...answers.filter(([key]) => EMAIL_INTAKE_KEYS.includes(key.toLowerCase())),
    ...answers.filter(([key]) => !EMAIL_INTAKE_KEYS.includes(key.toLowerCase())),
  ];
  for (const [, value] of ordered) {
    const email = capturedEmail(value);
    if (email) return email;
  }
  return null;
}

/**
 * What the customer is told when nobody answered in time (spec decision 12).
 * "By email" needs a captured email; without one it falls back to "here".
 */
export function expiredRequestMessage(
  ifNobodyAnswers: HandoffIfNobodyAnswers,
  companyName: string,
  email: string | null,
): string {
  if (ifNobodyAnswers === "reply_by_email" && email) {
    return `Sorry for the wait. The team at ${companyName} couldn't answer right away. They will reply to you by email at ${email}.`;
  }
  return `Sorry for the wait. The team at ${companyName} couldn't answer right away. They will reply to you here.`;
}

/**
 * Tell the customer their request expired. The request has already moved to
 * `expired` (Inbox "Waiting for you"), so this runs once per request.
 */
export async function tellCustomerRequestExpired(
  request: HandoffRequestRow,
): Promise<"saved" | "sent" | "skipped"> {
  const chat = await db.query.chats.findFirst({ where: eq(chats.id, request.chatId) });
  if (!chat || chat.companyId !== request.companyId) return "skipped";
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, request.companyId),
  });
  if (!company) return "skipped";

  const agentId = request.agentId ?? chat.agentId;
  const settings = agentId
    ? await getHandoffSettings({ id: agentId, companyId: request.companyId })
    : null;
  const ifNobodyAnswers = settings?.ifNobodyAnswers ?? "reply_here";
  let email: string | null = null;
  if (ifNobodyAnswers === "reply_by_email") {
    const record = await db.query.companyRecords.findFirst({
      where: eq(companyRecords.chatId, chat.id),
    });
    email = record && record.companyId === chat.companyId
      ? capturedEmailFromIntake(record.payload)
      : null;
  }

  const text = expiredRequestMessage(ifNobodyAnswers, company.name, email);
  const messageId = await saveAssistantMessage(chat.id, text, {
    [HANDOFF_EXPIRED_KEY]: request.id,
  });

  if (!isMessagingChannel(chat.channelType)) return "saved";
  const channel = agentId ? await findActiveChannel(agentId, chat.channelType) : undefined;
  const sent = await sendSavedMessageToCustomer({
    chatId: chat.id,
    channelType: chat.channelType,
    visitorId: chat.visitorId,
    channel,
    messageId,
    text,
  });
  return sent ? "sent" : "saved";
}

export type HandoffSweepResult = { expired: number; handedBack: number };

/**
 * One cron tick of handoff housekeeping: expire unanswered requests (every
 * mode) and tell each customer, then hand idle takeovers back to the agent.
 * The agent resumes on the customer's next message with the full transcript.
 * Never throws; one failing request does not stop the rest.
 */
export async function sweepHandoffRequests(
  now: Date = new Date(),
): Promise<HandoffSweepResult> {
  let expired: HandoffRequestRow[] = [];
  try {
    expired = await expireDueHandoffRequests(now);
  } catch (error) {
    console.error("[Handoff] expiry sweep failed", error);
  }
  for (const request of expired) {
    try {
      await tellCustomerRequestExpired(request);
    } catch (error) {
      console.error("[Handoff] expiry message failed", request.id, error);
    }
  }

  let handedBack: HandoffRequestRow[] = [];
  try {
    handedBack = await handBackIdleTakeovers(now);
  } catch (error) {
    console.error("[Handoff] idle hand-back sweep failed", error);
  }
  for (const request of handedBack) {
    console.info("[Handoff] idle takeover handed back", request.id);
  }

  return { expired: expired.length, handedBack: handedBack.length };
}
