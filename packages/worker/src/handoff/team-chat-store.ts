import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  channels,
  chats,
  db,
  handoffRequests,
  handoffTeamChatGroups,
  handoffTeamChatQuestions,
} from "@relay/db";
import type { WhatsAppSenderCredentials } from "../integrations/whatsapp";

/** Reads and writes behind Team chat (S109, spec decision 11). */

export type TeamChatGroupRow = typeof handoffTeamChatGroups.$inferSelect;
export type TeamChatQuestionRow = typeof handoffTeamChatQuestions.$inferSelect;

export async function getTeamChatGroup(agentId: string): Promise<TeamChatGroupRow | null> {
  const [row] = await db
    .select()
    .from(handoffTeamChatGroups)
    .where(eq(handoffTeamChatGroups.agentId, agentId))
    .limit(1);
  return row ?? null;
}

/** The group a webhook names, scoped to the sender it arrived on. */
export async function findTeamChatGroupByGroupId(
  phoneNumberId: string,
  groupId: string,
): Promise<TeamChatGroupRow | null> {
  const [row] = await db
    .select()
    .from(handoffTeamChatGroups)
    .where(
      and(
        eq(handoffTeamChatGroups.groupId, groupId),
        eq(handoffTeamChatGroups.phoneNumberId, phoneNumberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Whether the agent belongs to the company: the tenant check for internal calls. */
export async function isCompanyAgent(agentId: string, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
    .limit(1);
  return !!row;
}

/** The company's active WhatsApp sender with exactly this phone number id. */
export async function findCompanySender(
  companyId: string,
  phoneNumberId: string,
): Promise<WhatsAppSenderCredentials | null> {
  const [row] = await db
    .select({ config: channels.config })
    .from(channels)
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(channels.type, "whatsapp"),
        eq(channels.status, "active"),
        sql`${channels.config}->>'phoneNumberId' = ${phoneNumberId}`,
      ),
    )
    .limit(1);
  const { accessToken } = row?.config ?? {};
  return accessToken ? { phoneNumberId, accessToken } : null;
}

export async function saveTeamChatGroup(input: {
  agentId: string;
  companyId: string;
  phoneNumberId: string;
  subject: string;
  status: TeamChatGroupRow["status"];
  createRequestId: string | null;
  groupId: string | null;
  inviteLink: string | null;
  error: string | null;
  now: Date;
}): Promise<TeamChatGroupRow> {
  const values = {
    companyId: input.companyId,
    phoneNumberId: input.phoneNumberId,
    subject: input.subject,
    status: input.status,
    createRequestId: input.createRequestId,
    groupId: input.groupId,
    inviteLink: input.inviteLink,
    error: input.error,
    updatedAt: input.now,
  };
  const [row] = await db
    .insert(handoffTeamChatGroups)
    .values({ agentId: input.agentId, ...values, createdAt: input.now })
    .onConflictDoUpdate({ target: handoffTeamChatGroups.agentId, set: values })
    .returning();
  return row;
}

/** `group_lifecycle_update` for a create call: the group exists now, or failed. */
export async function settleTeamChatGroupCreate(input: {
  phoneNumberId: string;
  requestId: string;
  groupId: string | null;
  inviteLink: string | null;
  error: string | null;
  now: Date;
}): Promise<TeamChatGroupRow | null> {
  const [row] = await db
    .update(handoffTeamChatGroups)
    .set(
      input.error || !input.groupId
        ? { status: "failed", error: input.error ?? "No group id", updatedAt: input.now }
        : {
            status: "active",
            groupId: input.groupId,
            inviteLink: input.inviteLink,
            error: null,
            updatedAt: input.now,
          },
    )
    .where(
      and(
        eq(handoffTeamChatGroups.createRequestId, input.requestId),
        eq(handoffTeamChatGroups.phoneNumberId, input.phoneNumberId),
        eq(handoffTeamChatGroups.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function setTeamChatInviteLink(
  agentId: string,
  inviteLink: string,
  now: Date,
): Promise<void> {
  await db
    .update(handoffTeamChatGroups)
    .set({ inviteLink, updatedAt: now })
    .where(eq(handoffTeamChatGroups.agentId, agentId));
}

export async function isTeamChatCodeInUse(groupId: string, code: string): Promise<boolean> {
  const [row] = await db
    .select({ requestId: handoffTeamChatQuestions.requestId })
    .from(handoffTeamChatQuestions)
    .where(
      and(eq(handoffTeamChatQuestions.groupId, groupId), eq(handoffTeamChatQuestions.code, code)),
    )
    .limit(1);
  return !!row;
}

export async function saveTeamChatQuestion(input: {
  requestId: string;
  companyId: string;
  groupId: string;
  messageId: string;
  code: string;
  now: Date;
}): Promise<void> {
  await db
    .insert(handoffTeamChatQuestions)
    .values({ ...input, createdAt: input.now })
    .onConflictDoNothing();
}

/** A posted question by the quoted wamid, or by its reply code, within one group. */
export async function findTeamChatQuestion(
  groupId: string,
  match: { messageId: string } | { code: string },
): Promise<TeamChatQuestionRow | null> {
  const [row] = await db
    .select()
    .from(handoffTeamChatQuestions)
    .where(
      and(
        eq(handoffTeamChatQuestions.groupId, groupId),
        "messageId" in match
          ? eq(handoffTeamChatQuestions.messageId, match.messageId)
          : eq(handoffTeamChatQuestions.code, match.code),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The first group answer wins: one conditional UPDATE from `open`, before the
 * deadline. A redelivered webhook or a second reply finds it no longer open.
 * The answerer is recorded as the request's recipient for the Inbox chip.
 */
export async function answerTeamChatRequest(input: {
  requestId: string;
  companyId: string;
  answer: string;
  answeredByWaId: string;
  answeredByName: string | null;
  answerMessageId: string;
  now: Date;
}): Promise<boolean> {
  const rows = await db
    .update(handoffRequests)
    .set({
      status: "answered",
      answer: input.answer,
      replyMode: "agent",
      answeredAt: input.now,
      recipientName: input.answeredByName,
      recipientWhatsapp: input.answeredByWaId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(handoffRequests.id, input.requestId),
        eq(handoffRequests.companyId, input.companyId),
        eq(handoffRequests.mode, "team_chat"),
        eq(handoffRequests.status, "open"),
        sql`${handoffRequests.expiresAt} > ${input.now}`,
      ),
    )
    .returning({ id: handoffRequests.id });
  if (rows.length === 0) return false;
  await db
    .update(handoffTeamChatQuestions)
    .set({
      answeredByWaId: input.answeredByWaId,
      answeredByName: input.answeredByName,
      answerMessageId: input.answerMessageId,
    })
    .where(eq(handoffTeamChatQuestions.requestId, input.requestId));
  return true;
}

export async function markTeamChatConfirmed(
  requestId: string,
  confirmationMessageId: string,
): Promise<void> {
  await db
    .update(handoffTeamChatQuestions)
    .set({ confirmationMessageId })
    .where(eq(handoffTeamChatQuestions.requestId, requestId));
}

/** How the group names the customer: the conversation title (WhatsApp profile name). */
export async function getCustomerName(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: chats.title })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  return row?.title ?? null;
}
