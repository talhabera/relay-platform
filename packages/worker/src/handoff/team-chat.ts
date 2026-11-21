import { randomInt } from "node:crypto";
import {
  createWhatsAppGroup,
  getWhatsAppGroupInviteLink,
  isOfficialBusinessAccount,
  sendWhatsAppGroupText,
  type WhatsAppSenderCredentials,
  type WhatsAppSendResult,
} from "../integrations/whatsapp";
import {
  parseWhatsAppGroupWebhook,
  type GroupLifecycleEvent,
  type GroupMessageEvent,
} from "../integrations/whatsapp-groups";
import { enqueue } from "../serial-queue";
import { findFollowUpText, runHandoffFollowUp } from "./follow-up";
import { findStaffSender, getCompanyName, markHandoffNotified } from "./staff-store";
import { getHandoffRequest, type HandoffRequestRow } from "./store";
import {
  answerTeamChatRequest,
  findCompanySender,
  findTeamChatGroupByGroupId,
  findTeamChatQuestion,
  getCustomerName,
  getTeamChatGroup,
  isCompanyAgent,
  isTeamChatCodeInUse,
  markTeamChatConfirmed,
  saveTeamChatGroup,
  saveTeamChatQuestion,
  setTeamChatInviteLink,
  settleTeamChatGroupCreate,
  type TeamChatGroupRow,
  type TeamChatQuestionRow,
} from "./team-chat-store";

/**
 * Team chat (spec decision 11). The agent posts the question in the agent's
 * WhatsApp group; the first reply that quotes it is the answer; the agent
 * rephrases it to the customer and confirms in the group. No quick link, no
 * recipient confirmation, no takeover, no 1:1 fan-out fallback.
 *
 * Only an Official Business Account sender may use groups. Without one, Team
 * chat stays off: no group is created and every request stays Inbox-only.
 *
 * Quote matching: `context.id` on a group reply is undocumented
 * (docs/research/whatsapp-groups-payload.md), so a reply also counts when it
 * starts with the question's reply code ("#K7Q2 …"). Any other group message
 * is ignored.
 */

export const TEAM_CHAT_NEEDS_OBA = "Needs an Official Business Account";
export const TEAM_CHAT_TOO_LATE = "Too late, this is now in the Inbox.";

/** No 0/O, 1/I/L: the code is read off a phone and typed back. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const CODE_ATTEMPTS = 5;

export function generateReplyCode(pick: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

const CODE_PREFIX = new RegExp(`^\\s*#([${CODE_ALPHABET}]{${CODE_LENGTH}})(?![A-Z0-9])[\\s:,.-]*`, "i");

/** A leading "#K7Q2" and the answer after it, or null when the reply has none. */
export function extractReplyCode(text: string): { code: string; rest: string } | null {
  const match = CODE_PREFIX.exec(text);
  if (!match) return null;
  return { code: match[1].toUpperCase(), rest: text.slice(match[0].length).trim() };
}

/** Drop a leading reply code the person typed even when they also quoted. */
export function answerText(text: string): string {
  return extractReplyCode(text)?.rest ?? text.trim();
}

export function teamChatQuestionText(input: {
  code: string;
  customerName: string;
  question: string;
}): string {
  return [
    `#${input.code} ${input.customerName} asks: ${input.question}`,
    "",
    `Reply to this message to answer, or start your message with #${input.code}. The first answer is sent.`,
  ].join("\n");
}

export function sentConfirmationText(customerName: string, sent: string): string {
  return `Sent to ${customerName}: «${sent}»`;
}

const CUSTOMER_FALLBACK = "the customer";

// --- Posting the question ---------------------------------------------------

export type TeamChatPostOutcome =
  | { posted: true; messageId: string; code: string }
  | {
      posted: false;
      reason: "no_group" | "no_sender" | "needs_oba" | "failed";
      error?: string;
    };

export interface TeamChatDeps {
  getGroup: (agentId: string) => Promise<TeamChatGroupRow | null>;
  findGroupByGroupId: (
    phoneNumberId: string,
    groupId: string,
  ) => Promise<TeamChatGroupRow | null>;
  findSender: (
    companyId: string,
    phoneNumberId: string,
  ) => Promise<WhatsAppSenderCredentials | null>;
  findStaffSender: (
    companyId: string,
    agentId: string | null,
  ) => Promise<WhatsAppSenderCredentials | null>;
  isOba: (sender: WhatsAppSenderCredentials) => Promise<boolean>;
  sendGroupText: (
    sender: WhatsAppSenderCredentials,
    groupId: string,
    text: string,
    quoteMessageId?: string | null,
  ) => Promise<WhatsAppSendResult>;
  createGroup: typeof createWhatsAppGroup;
  getInviteLink: typeof getWhatsAppGroupInviteLink;
  codeInUse: (groupId: string, code: string) => Promise<boolean>;
  generateCode: () => string;
  saveQuestion: typeof saveTeamChatQuestion;
  findQuestion: typeof findTeamChatQuestion;
  getRequest: (requestId: string) => Promise<HandoffRequestRow | null>;
  answer: typeof answerTeamChatRequest;
  markNotified: (requestId: string, at: Date) => Promise<void>;
  customerName: (chatId: string) => Promise<string | null>;
  companyName: (companyId: string) => Promise<string | null>;
  isCompanyAgent: (agentId: string, companyId: string) => Promise<boolean>;
  saveGroup: typeof saveTeamChatGroup;
  settleGroupCreate: typeof settleTeamChatGroupCreate;
  setInviteLink: typeof setTeamChatInviteLink;
  /** Run the agent's follow-up, then confirm in the group (queued per chat). */
  scheduleAnswered: (answered: AnsweredTeamChat) => void;
  now: () => Date;
}

export type AnsweredTeamChat = {
  request: HandoffRequestRow;
  group: TeamChatGroupRow;
  answerMessageId: string;
};

// Store functions are wrapped so a test that mocks `./store` or
// `./staff-store` without them can still import this module.
const baseDeps: Omit<TeamChatDeps, "scheduleAnswered"> = {
  getGroup: getTeamChatGroup,
  findGroupByGroupId: findTeamChatGroupByGroupId,
  findSender: findCompanySender,
  findStaffSender: (companyId, agentId) => findStaffSender(companyId, agentId),
  isOba: isOfficialBusinessAccount,
  sendGroupText: sendWhatsAppGroupText,
  createGroup: createWhatsAppGroup,
  getInviteLink: getWhatsAppGroupInviteLink,
  codeInUse: isTeamChatCodeInUse,
  generateCode: () => generateReplyCode(),
  saveQuestion: saveTeamChatQuestion,
  findQuestion: findTeamChatQuestion,
  getRequest: (requestId) => getHandoffRequest(requestId),
  answer: answerTeamChatRequest,
  markNotified: (requestId, at) => markHandoffNotified(requestId, at),
  customerName: getCustomerName,
  companyName: (companyId) => getCompanyName(companyId),
  isCompanyAgent,
  saveGroup: saveTeamChatGroup,
  settleGroupCreate: settleTeamChatGroupCreate,
  setInviteLink: setTeamChatInviteLink,
  now: () => new Date(),
};

const defaultDeps: TeamChatDeps = {
  ...baseDeps,
  scheduleAnswered: (answered) => {
    enqueue(`chat:${answered.request.chatId}`, async () => {
      try {
        await followUpAndConfirm(answered);
      } catch (cause) {
        console.error("[TeamChat] follow-up failed", answered.request.id, cause);
      }
    });
  },
};

function withDeps(overrides: Partial<TeamChatDeps>): TeamChatDeps {
  return { ...defaultDeps, ...overrides };
}

/** A usable group: active, with a group id, on a sender that is still an OBA. */
async function readyGroup(
  agentId: string | null,
  companyId: string,
  deps: TeamChatDeps,
): Promise<
  | { ok: true; group: TeamChatGroupRow & { groupId: string }; sender: WhatsAppSenderCredentials }
  | { ok: false; reason: "no_group" | "no_sender" | "needs_oba" }
> {
  const group = agentId ? await deps.getGroup(agentId) : null;
  if (!group || group.companyId !== companyId || group.status !== "active" || !group.groupId) {
    return { ok: false, reason: "no_group" };
  }
  const sender = await deps.findSender(companyId, group.phoneNumberId);
  if (!sender) return { ok: false, reason: "no_sender" };
  if (!(await deps.isOba(sender))) return { ok: false, reason: "needs_oba" };
  return { ok: true, group: { ...group, groupId: group.groupId }, sender };
}

/**
 * Post a newly opened Team chat request in the agent's group. Any reason it
 * cannot leaves the request in the Inbox; there is no 1:1 fallback.
 */
export async function postTeamChatQuestion(
  request: HandoffRequestRow,
  overrides: Partial<TeamChatDeps> = {},
): Promise<TeamChatPostOutcome> {
  const deps = withDeps(overrides);
  const ready = await readyGroup(request.agentId, request.companyId, deps);
  if (!ready.ok) {
    console.info("[TeamChat] request stays in the Inbox", request.id, ready.reason);
    return { posted: false, reason: ready.reason };
  }
  const { group, sender } = ready;

  let code: string | null = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt++) {
    const candidate = deps.generateCode();
    if (!(await deps.codeInUse(group.groupId, candidate))) code = candidate;
  }
  if (!code) return { posted: false, reason: "failed", error: "No free reply code" };

  const customerName = (await deps.customerName(request.chatId)) ?? CUSTOMER_FALLBACK;
  const sent = await deps.sendGroupText(
    sender,
    group.groupId,
    teamChatQuestionText({
      code,
      customerName,
      question: request.questions[0]?.text ?? request.reason,
    }),
  );
  if (!sent.success) {
    console.error("[TeamChat] question not posted", request.id, sent.error);
    return { posted: false, reason: "failed", error: sent.error };
  }

  const now = deps.now();
  await deps.saveQuestion({
    requestId: request.id,
    companyId: request.companyId,
    groupId: group.groupId,
    messageId: sent.messageId,
    code,
    now,
  });
  await deps.markNotified(request.id, now);
  console.info("[TeamChat] question posted", request.id, sent.messageId);
  return { posted: true, messageId: sent.messageId, code };
}

// --- Group replies ----------------------------------------------------------

export type GroupMessageOutcome = "answered" | "too_late" | "ignored";

async function matchQuestion(
  event: GroupMessageEvent,
  deps: TeamChatDeps,
): Promise<TeamChatQuestionRow | null> {
  if (event.quotedMessageId) {
    const quoted = await deps.findQuestion(event.groupId, { messageId: event.quotedMessageId });
    if (quoted) return quoted;
  }
  const coded = extractReplyCode(event.text);
  return coded ? deps.findQuestion(event.groupId, { code: coded.code }) : null;
}

/**
 * One inbound group message. Only a reply that quotes a question (or carries
 * its code) counts; the first one before the deadline is the answer. A reply
 * to an expired question gets "Too late, this is now in the Inbox." Every
 * other message, including later replies to an answered question, is ignored.
 */
export async function handleTeamChatGroupMessage(
  event: GroupMessageEvent,
  overrides: Partial<TeamChatDeps> = {},
): Promise<GroupMessageOutcome> {
  const deps = withDeps(overrides);
  const group = await deps.findGroupByGroupId(event.phoneNumberId, event.groupId);
  if (!group || group.status !== "active") return "ignored";

  const question = await matchQuestion(event, deps);
  if (!question || question.companyId !== group.companyId) return "ignored";

  const request = await deps.getRequest(question.requestId);
  if (!request || request.companyId !== group.companyId || request.mode !== "team_chat") {
    return "ignored";
  }

  const answer = answerText(event.text);
  const now = deps.now();
  const late =
    request.status === "expired" ||
    (request.status === "open" && request.expiresAt.getTime() <= now.getTime());

  if (!late) {
    if (request.status !== "open" || !answer) return "ignored";
    const won = await deps.answer({
      requestId: request.id,
      companyId: request.companyId,
      answer,
      answeredByWaId: event.fromWaId,
      answeredByName: event.profileName,
      answerMessageId: event.messageId,
      now,
    });
    if (won) {
      deps.scheduleAnswered({
        request: {
          ...request,
          status: "answered",
          answer,
          replyMode: "agent",
          answeredAt: now,
        },
        group,
        answerMessageId: event.messageId,
      });
      console.info("[TeamChat] answered in the group", request.id);
      return "answered";
    }
    // Lost to a concurrent answer or the expiry sweep: read what happened.
    const after = await deps.getRequest(request.id);
    if (after?.status !== "expired") return "ignored";
  }

  const sender = await deps.findSender(group.companyId, group.phoneNumberId);
  if (sender && group.groupId) {
    await deps.sendGroupText(sender, group.groupId, TEAM_CHAT_TOO_LATE, event.messageId);
  }
  return "too_late";
}

/**
 * After a group answer: the agent rephrases it to the customer (the normal
 * follow-up), then quote-replies in the group with what was actually sent.
 */
export async function followUpAndConfirm(
  answered: AnsweredTeamChat,
  overrides: Partial<TeamChatDeps> & {
    runFollowUp?: typeof runHandoffFollowUp;
    followUpText?: typeof findFollowUpText;
    markConfirmed?: typeof markTeamChatConfirmed;
  } = {},
): Promise<"confirmed" | "not_sent"> {
  const deps = withDeps(overrides);
  const runFollowUp = overrides.runFollowUp ?? runHandoffFollowUp;
  const followUpText = overrides.followUpText ?? findFollowUpText;
  const markConfirmed = overrides.markConfirmed ?? markTeamChatConfirmed;
  const { request, group } = answered;

  await runFollowUp(request.id);
  const sent = await followUpText(request.chatId, request.id);
  if (!sent || !group.groupId) {
    console.warn("[TeamChat] no follow-up to confirm", request.id);
    return "not_sent";
  }
  const sender = await deps.findSender(group.companyId, group.phoneNumberId);
  if (!sender) return "not_sent";
  const customerName = (await deps.customerName(request.chatId)) ?? CUSTOMER_FALLBACK;
  const confirmation = await deps.sendGroupText(
    sender,
    group.groupId,
    sentConfirmationText(customerName, sent),
    answered.answerMessageId,
  );
  if (!confirmation.success) {
    console.error("[TeamChat] confirmation not posted", request.id, confirmation.error);
    return "not_sent";
  }
  await markConfirmed(request.id, confirmation.messageId);
  return "confirmed";
}

// --- Group setup ------------------------------------------------------------

export type TeamChatGroupStatusResult =
  | { status: "active"; inviteLink: string | null }
  | { status: "pending" }
  | { status: "needs_oba"; message: typeof TEAM_CHAT_NEEDS_OBA }
  | { status: "not_found" | "no_sender" }
  | { status: "failed"; error: string };

/**
 * Create the agent's group (once) and return its invite link. Idempotent: an
 * active or pending group is returned as is. Refused without an Official
 * Business Account, which is what keeps Team chat disabled.
 */
export async function ensureTeamChatGroup(
  agent: { id: string; companyId: string },
  overrides: Partial<TeamChatDeps> = {},
): Promise<TeamChatGroupStatusResult> {
  const deps = withDeps(overrides);
  if (!(await deps.isCompanyAgent(agent.id, agent.companyId))) return { status: "not_found" };

  const existing = await deps.getGroup(agent.id);
  if (existing && existing.companyId !== agent.companyId) return { status: "not_found" };
  if (existing?.status === "pending") return { status: "pending" };

  if (existing?.status === "active" && existing.groupId) {
    const sender = await deps.findSender(agent.companyId, existing.phoneNumberId);
    if (!sender) return { status: "no_sender" };
    if (!(await deps.isOba(sender))) return { status: "needs_oba", message: TEAM_CHAT_NEEDS_OBA };
    let inviteLink = existing.inviteLink;
    if (!inviteLink) {
      inviteLink = await deps.getInviteLink(sender, existing.groupId);
      if (inviteLink) await deps.setInviteLink(agent.id, inviteLink, deps.now());
    }
    return { status: "active", inviteLink };
  }

  const sender = await deps.findStaffSender(agent.companyId, agent.id);
  if (!sender) return { status: "no_sender" };
  if (!(await deps.isOba(sender))) return { status: "needs_oba", message: TEAM_CHAT_NEEDS_OBA };

  const companyName = (await deps.companyName(agent.companyId)) ?? "Team";
  const subject = `${companyName} handoff`;
  const created = await deps.createGroup(sender, {
    subject,
    description: `Customer questions for ${companyName}. Reply to a question to answer it.`,
  });
  const now = deps.now();
  if (!created.success) {
    console.error("[TeamChat] group create failed", agent.id, created.error);
    return { status: "failed", error: created.error };
  }

  let inviteLink = created.inviteLink;
  if (created.groupId && !inviteLink) {
    inviteLink = await deps.getInviteLink(sender, created.groupId);
  }
  const row = await deps.saveGroup({
    agentId: agent.id,
    companyId: agent.companyId,
    phoneNumberId: sender.phoneNumberId,
    subject,
    status: created.groupId ? "active" : "pending",
    createRequestId: created.requestId,
    groupId: created.groupId,
    inviteLink,
    error: null,
    now,
  });
  return row.status === "active"
    ? { status: "active", inviteLink: row.inviteLink }
    : { status: "pending" };
}

export type TeamChatAvailability =
  | { available: true }
  | { available: false; reason: "no_sender" | "needs_oba"; message: typeof TEAM_CHAT_NEEDS_OBA };

/**
 * Whether the agent could use Team chat: the company's WhatsApp sender is an
 * Official Business Account. Read-only, unlike `ensureTeamChatGroup`, so the
 * settings UI can grey out the mode before anyone picks it.
 */
export async function checkTeamChatAvailability(
  agent: { id: string; companyId: string },
  overrides: Partial<TeamChatDeps> = {},
): Promise<TeamChatAvailability | { available: false; reason: "not_found" }> {
  const deps = withDeps(overrides);
  if (!(await deps.isCompanyAgent(agent.id, agent.companyId))) {
    return { available: false, reason: "not_found" };
  }
  const sender = await deps.findStaffSender(agent.companyId, agent.id);
  if (!sender) return { available: false, reason: "no_sender", message: TEAM_CHAT_NEEDS_OBA };
  if (!(await deps.isOba(sender))) {
    return { available: false, reason: "needs_oba", message: TEAM_CHAT_NEEDS_OBA };
  }
  return { available: true };
}

/** `group_lifecycle_update`: a pending group becomes active with its invite link. */
export async function handleTeamChatLifecycle(
  event: GroupLifecycleEvent,
  overrides: Partial<TeamChatDeps> = {},
): Promise<"activated" | "failed" | "ignored"> {
  const deps = withDeps(overrides);
  if (event.type !== "group_create" || !event.requestId) return "ignored";
  const row = await deps.settleGroupCreate({
    phoneNumberId: event.phoneNumberId,
    requestId: event.requestId,
    groupId: event.groupId,
    inviteLink: event.inviteLink,
    error: event.error,
    now: deps.now(),
  });
  if (!row) return "ignored";
  if (row.status !== "active") return "failed";
  if (!row.inviteLink && row.groupId) {
    const sender = await deps.findSender(row.companyId, row.phoneNumberId);
    const link = sender ? await deps.getInviteLink(sender, row.groupId) : null;
    if (link) await deps.setInviteLink(row.agentId, link, deps.now());
  }
  return "activated";
}

// --- Internal routes --------------------------------------------------------

export type InternalJsonResponse = { status: number; body: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_FOR_GROUP: Record<TeamChatGroupStatusResult["status"], number> = {
  active: 200,
  pending: 202,
  needs_oba: 409,
  no_sender: 409,
  not_found: 404,
  failed: 502,
};

/**
 * `POST /internal/handoff/team-chat-group {agentId, companyId}`: the settings
 * UI asks for the agent's group and invite link (creating it once).
 */
export async function handleTeamChatGroupRequest(
  body: unknown,
  overrides: Partial<TeamChatDeps> = {},
): Promise<InternalJsonResponse> {
  const { agentId, companyId } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof agentId !== "string" ||
    typeof companyId !== "string" ||
    !UUID.test(agentId) ||
    !UUID.test(companyId)
  ) {
    return { status: 400, body: JSON.stringify({ status: "invalid" }) };
  }
  const result = await ensureTeamChatGroup({ id: agentId, companyId }, overrides);
  return { status: STATUS_FOR_GROUP[result.status], body: JSON.stringify(result) };
}

/**
 * `POST /internal/handoff/team-chat-availability {agentId, companyId}`: the
 * settings UI asks whether Team chat can be chosen. Never creates a group.
 */
export async function handleTeamChatAvailabilityRequest(
  body: unknown,
  overrides: Partial<TeamChatDeps> = {},
): Promise<InternalJsonResponse> {
  const { agentId, companyId } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof agentId !== "string" ||
    typeof companyId !== "string" ||
    !UUID.test(agentId) ||
    !UUID.test(companyId)
  ) {
    return { status: 400, body: JSON.stringify({ status: "invalid" }) };
  }
  const result = await checkTeamChatAvailability({ id: agentId, companyId }, overrides);
  if (!result.available && result.reason === "not_found") {
    return { status: 404, body: JSON.stringify({ status: "not_found" }) };
  }
  return { status: 200, body: JSON.stringify(result) };
}

/**
 * `POST /internal/whatsapp/groups`: the verified WhatsApp webhook body,
 * forwarded by the web app. Group messages and lifecycle updates are handled
 * here; everything else in the body is ignored. One failing event does not
 * stop the rest.
 */
export async function handleTeamChatWebhook(
  body: unknown,
  overrides: Partial<TeamChatDeps> = {},
): Promise<InternalJsonResponse> {
  const events = parseWhatsAppGroupWebhook(body);
  const counts = { answered: 0, too_late: 0, ignored: 0, activated: 0, failed: 0 };
  for (const event of events.lifecycle) {
    try {
      const outcome = await handleTeamChatLifecycle(event, overrides);
      if (outcome === "activated") counts.activated++;
      else if (outcome === "failed") counts.failed++;
      else counts.ignored++;
    } catch (cause) {
      counts.failed++;
      console.error("[TeamChat] lifecycle event failed", cause);
    }
  }
  for (const event of events.messages) {
    try {
      counts[await handleTeamChatGroupMessage(event, overrides)]++;
    } catch (cause) {
      counts.failed++;
      console.error("[TeamChat] group message failed", event.messageId, cause);
    }
  }
  return { status: 200, body: JSON.stringify(counts) };
}
