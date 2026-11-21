import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./follow-up", () => ({
  runHandoffFollowUp: vi.fn(),
  findFollowUpText: vi.fn(),
}));

import { parseWhatsAppGroupWebhook } from "../integrations/whatsapp-groups";
import {
  answerText,
  ensureTeamChatGroup,
  extractReplyCode,
  followUpAndConfirm,
  generateReplyCode,
  handleTeamChatGroupMessage,
  checkTeamChatAvailability,
  handleTeamChatAvailabilityRequest,
  handleTeamChatGroupRequest,
  handleTeamChatLifecycle,
  handleTeamChatWebhook,
  postTeamChatQuestion,
  sentConfirmationText,
  TEAM_CHAT_NEEDS_OBA,
  TEAM_CHAT_TOO_LATE,
  teamChatQuestionText,
  type TeamChatDeps,
} from "./team-chat";
import type { TeamChatGroupRow, TeamChatQuestionRow } from "./team-chat-store";
import type { HandoffRequestRow } from "./store";

const NOW = new Date("2026-10-03T10:00:00Z");
const LATER = new Date("2026-10-03T12:00:00Z");
const SENDER = { phoneNumberId: "PNID1", accessToken: "EAAGtoken" };
const GROUP_ID = "HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA";
const AGENT = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";

function request(overrides: Partial<HandoffRequestRow> = {}): HandoffRequestRow {
  return {
    id: "req-1",
    companyId: COMPANY,
    agentId: AGENT,
    chatId: "chat-1",
    status: "open",
    mode: "team_chat",
    tokenHash: null,
    reason: "Price is not in the price list",
    confidence: 30,
    questions: [{ text: "Can we do 140 m2 for 300k?", askedAt: NOW.toISOString() }],
    suggestedReplies: [],
    recipientName: null,
    recipientWhatsapp: null,
    canTakeOver: false,
    notifiedAt: null,
    notificationMessageId: null,
    notificationStatus: null,
    notificationStatusAt: null,
    notificationError: null,
    expiresAt: LATER,
    answer: null,
    replyMode: null,
    answeredAt: null,
    takenOverAt: null,
    lastHumanMessageAt: null,
    handedBackAt: null,
    handBackReason: null,
    expiredAt: null,
    linkClosedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function group(overrides: Partial<TeamChatGroupRow> = {}): TeamChatGroupRow {
  return {
    agentId: AGENT,
    companyId: COMPANY,
    phoneNumberId: "PNID1",
    status: "active",
    subject: "Acme GmbH handoff",
    createRequestId: "REQ1",
    groupId: GROUP_ID,
    inviteLink: "https://chat.whatsapp.com/ABC",
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function question(overrides: Partial<TeamChatQuestionRow> = {}): TeamChatQuestionRow {
  return {
    requestId: "req-1",
    companyId: COMPANY,
    groupId: GROUP_ID,
    messageId: "wamid.Q1",
    code: "K7Q2",
    answeredByWaId: null,
    answeredByName: null,
    answerMessageId: null,
    confirmationMessageId: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** A mocked inbound group webhook, as Meta would post it. */
function groupWebhook(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "PNID1" },
              contacts: [{ wa_id: "4915100000001", profile: { name: "Markus" } }],
              messages: [
                {
                  from: "4915100000001",
                  group_id: GROUP_ID,
                  id: "wamid.A1",
                  timestamp: "1790000000",
                  type: "text",
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function eventFrom(message: Record<string, unknown>) {
  return parseWhatsAppGroupWebhook(groupWebhook(message)).messages[0];
}

let deps: { [K in keyof TeamChatDeps]: ReturnType<typeof vi.fn> } & { now: () => Date };

beforeEach(() => {
  deps = {
    getGroup: vi.fn().mockResolvedValue(group()),
    findGroupByGroupId: vi.fn().mockResolvedValue(group()),
    findSender: vi.fn().mockResolvedValue(SENDER),
    findStaffSender: vi.fn().mockResolvedValue(SENDER),
    isOba: vi.fn().mockResolvedValue(true),
    sendGroupText: vi
      .fn()
      .mockResolvedValue({ success: true, messageId: "wamid.OUT", error: null }),
    createGroup: vi.fn(),
    getInviteLink: vi.fn().mockResolvedValue("https://chat.whatsapp.com/NEW"),
    codeInUse: vi.fn().mockResolvedValue(false),
    generateCode: vi.fn().mockReturnValue("K7Q2"),
    saveQuestion: vi.fn().mockResolvedValue(undefined),
    findQuestion: vi.fn().mockResolvedValue(null),
    getRequest: vi.fn().mockResolvedValue(request()),
    answer: vi.fn().mockResolvedValue(true),
    markNotified: vi.fn().mockResolvedValue(undefined),
    customerName: vi.fn().mockResolvedValue("Lukas"),
    companyName: vi.fn().mockResolvedValue("Acme GmbH"),
    isCompanyAgent: vi.fn().mockResolvedValue(true),
    saveGroup: vi.fn(),
    settleGroupCreate: vi.fn(),
    setInviteLink: vi.fn().mockResolvedValue(undefined),
    scheduleAnswered: vi.fn(),
    now: () => NOW,
  } as never;
});

describe("reply codes and copy", () => {
  it("generates a 4-character code without look-alike characters", () => {
    const code = generateReplyCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
  });

  it("extracts a leading code and strips it from the answer", () => {
    expect(extractReplyCode("#k7q2: yes, 300k works")).toEqual({
      code: "K7Q2",
      rest: "yes, 300k works",
    });
    expect(extractReplyCode("yes #K7Q2")).toBeNull();
    expect(extractReplyCode("#K7Q2X nope")).toBeNull();
    expect(answerText("  #K7Q2 yes ")).toBe("yes");
    expect(answerText(" yes ")).toBe("yes");
  });

  it("formats the question and the confirmation", () => {
    expect(
      teamChatQuestionText({ code: "K7Q2", customerName: "Lukas", question: "300k?" }),
    ).toBe(
      "#K7Q2 Lukas asks: 300k?\n\nReply to this message to answer, or start your message with #K7Q2. The first answer is sent.",
    );
    expect(sentConfirmationText("Lukas", "Yes, we can.")).toBe("Sent to Lukas: «Yes, we can.»");
  });
});

describe("postTeamChatQuestion", () => {
  it("posts the question in the agent's group and records it", async () => {
    const outcome = await postTeamChatQuestion(request(), deps);

    expect(outcome).toEqual({ posted: true, messageId: "wamid.OUT", code: "K7Q2" });
    expect(deps.sendGroupText).toHaveBeenCalledWith(
      SENDER,
      GROUP_ID,
      expect.stringContaining("#K7Q2 Lukas asks: Can we do 140 m2 for 300k?"),
    );
    expect(deps.saveQuestion).toHaveBeenCalledWith({
      requestId: "req-1",
      companyId: COMPANY,
      groupId: GROUP_ID,
      messageId: "wamid.OUT",
      code: "K7Q2",
      now: NOW,
    });
    expect(deps.markNotified).toHaveBeenCalledWith("req-1", NOW);
  });

  it("stays disabled without an Official Business Account: nothing is posted", async () => {
    deps.isOba.mockResolvedValue(false);

    expect(await postTeamChatQuestion(request(), deps)).toEqual({
      posted: false,
      reason: "needs_oba",
    });
    expect(deps.sendGroupText).not.toHaveBeenCalled();
    expect(deps.markNotified).not.toHaveBeenCalled();
  });

  it("keeps the request in the Inbox when the group is missing or still pending", async () => {
    deps.getGroup.mockResolvedValueOnce(null);
    expect(await postTeamChatQuestion(request(), deps)).toEqual({
      posted: false,
      reason: "no_group",
    });
    deps.getGroup.mockResolvedValueOnce(group({ status: "pending", groupId: null }));
    expect(await postTeamChatQuestion(request(), deps)).toEqual({
      posted: false,
      reason: "no_group",
    });
    deps.getGroup.mockResolvedValueOnce(group({ companyId: "other" }));
    expect(await postTeamChatQuestion(request(), deps)).toEqual({
      posted: false,
      reason: "no_group",
    });
    expect(deps.sendGroupText).not.toHaveBeenCalled();
  });

  it("picks a code not already used in the group", async () => {
    deps.codeInUse.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    deps.generateCode.mockReturnValueOnce("AAAA").mockReturnValueOnce("BBBB");

    const outcome = await postTeamChatQuestion(request(), deps);
    expect(outcome).toMatchObject({ posted: true, code: "BBBB" });
  });

  it("reports a failed post without marking the request notified", async () => {
    deps.sendGroupText.mockResolvedValue({ success: false, messageId: null, error: "boom" });
    expect(await postTeamChatQuestion(request(), deps)).toEqual({
      posted: false,
      reason: "failed",
      error: "boom",
    });
    expect(deps.saveQuestion).not.toHaveBeenCalled();
    expect(deps.markNotified).not.toHaveBeenCalled();
  });
});

describe("handleTeamChatGroupMessage (mocked Groups webhook)", () => {
  it("takes the first quote-reply as the answer and schedules the follow-up", async () => {
    deps.findQuestion.mockResolvedValue(question());
    const event = eventFrom({
      text: { body: "Yes, 300k works" },
      context: { from: "15550001111", id: "wamid.Q1" },
    });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("answered");
    expect(deps.findQuestion).toHaveBeenCalledWith(GROUP_ID, { messageId: "wamid.Q1" });
    expect(deps.answer).toHaveBeenCalledWith({
      requestId: "req-1",
      companyId: COMPANY,
      answer: "Yes, 300k works",
      answeredByWaId: "4915100000001",
      answeredByName: "Markus",
      answerMessageId: "wamid.A1",
      now: NOW,
    });
    expect(deps.scheduleAnswered).toHaveBeenCalledWith(
      expect.objectContaining({
        answerMessageId: "wamid.A1",
        request: expect.objectContaining({ status: "answered", answer: "Yes, 300k works" }),
      }),
    );
    expect(deps.sendGroupText).not.toHaveBeenCalled();
  });

  it("matches by reply code when the webhook has no quote context", async () => {
    deps.findQuestion.mockImplementation(async (_g: string, match: { code?: string }) =>
      match.code === "K7Q2" ? question() : null,
    );
    const event = eventFrom({ text: { body: "#K7Q2 yes, 300k works" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("answered");
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "yes, 300k works" }),
    );
  });

  it("ignores group chatter that neither quotes nor carries a code", async () => {
    const event = eventFrom({ text: { body: "who is getting lunch?" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("ignored");
    expect(deps.findQuestion).not.toHaveBeenCalled();
    expect(deps.answer).not.toHaveBeenCalled();
  });

  it("ignores a second reply once the question is answered", async () => {
    deps.findQuestion.mockResolvedValue(question());
    deps.getRequest.mockResolvedValue(request({ status: "answered", answer: "first" }));
    const event = eventFrom({ text: { body: "me too" }, context: { id: "wamid.Q1" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("ignored");
    expect(deps.answer).not.toHaveBeenCalled();
    expect(deps.sendGroupText).not.toHaveBeenCalled();
  });

  it('answers a reply after expiry with "Too late", quoting it', async () => {
    deps.findQuestion.mockResolvedValue(question());
    deps.getRequest.mockResolvedValue(request({ status: "expired", expiredAt: NOW }));
    const event = eventFrom({ text: { body: "Yes" }, context: { id: "wamid.Q1" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("too_late");
    expect(deps.answer).not.toHaveBeenCalled();
    expect(deps.sendGroupText).toHaveBeenCalledWith(
      SENDER,
      GROUP_ID,
      TEAM_CHAT_TOO_LATE,
      "wamid.A1",
    );
  });

  it("treats an open request past its deadline as too late (the sweep expires it)", async () => {
    deps.findQuestion.mockResolvedValue(question());
    deps.getRequest.mockResolvedValue(request({ expiresAt: new Date(NOW.getTime() - 1) }));
    const event = eventFrom({ text: { body: "Yes" }, context: { id: "wamid.Q1" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("too_late");
    expect(deps.answer).not.toHaveBeenCalled();
  });

  it("says too late when the sweep wins the race", async () => {
    deps.findQuestion.mockResolvedValue(question());
    deps.answer.mockResolvedValue(false);
    deps.getRequest
      .mockResolvedValueOnce(request())
      .mockResolvedValueOnce(request({ status: "expired" }));
    const event = eventFrom({ text: { body: "Yes" }, context: { id: "wamid.Q1" } });

    expect(await handleTeamChatGroupMessage(event, deps)).toBe("too_late");
    expect(deps.scheduleAnswered).not.toHaveBeenCalled();
  });

  it("ignores a group that is not ours or a question of another company", async () => {
    deps.findGroupByGroupId.mockResolvedValueOnce(null);
    const event = eventFrom({ text: { body: "Yes" }, context: { id: "wamid.Q1" } });
    expect(await handleTeamChatGroupMessage(event, deps)).toBe("ignored");

    deps.findQuestion.mockResolvedValue(question({ companyId: "other" }));
    expect(await handleTeamChatGroupMessage(event, deps)).toBe("ignored");
    expect(deps.answer).not.toHaveBeenCalled();
  });
});

describe("followUpAndConfirm", () => {
  it("runs the follow-up, then quote-replies in the group with what was sent", async () => {
    const runFollowUp = vi.fn().mockResolvedValue("sent");
    const followUpText = vi.fn().mockResolvedValue("Good news, 300k works for 140 m2.");
    const markConfirmed = vi.fn().mockResolvedValue(undefined);

    const outcome = await followUpAndConfirm(
      { request: request({ status: "answered" }), group: group(), answerMessageId: "wamid.A1" },
      { ...deps, runFollowUp, followUpText, markConfirmed },
    );

    expect(outcome).toBe("confirmed");
    expect(runFollowUp).toHaveBeenCalledWith("req-1");
    expect(deps.sendGroupText).toHaveBeenCalledWith(
      SENDER,
      GROUP_ID,
      "Sent to Lukas: «Good news, 300k works for 140 m2.»",
      "wamid.A1",
    );
    expect(markConfirmed).toHaveBeenCalledWith("req-1", "wamid.OUT");
  });

  it("confirms nothing when no follow-up went out", async () => {
    const outcome = await followUpAndConfirm(
      { request: request({ status: "answered" }), group: group(), answerMessageId: "wamid.A1" },
      {
        ...deps,
        runFollowUp: vi.fn().mockResolvedValue("skipped"),
        followUpText: vi.fn().mockResolvedValue(null),
        markConfirmed: vi.fn(),
      },
    );
    expect(outcome).toBe("not_sent");
    expect(deps.sendGroupText).not.toHaveBeenCalled();
  });
});

describe("ensureTeamChatGroup", () => {
  const agent = { id: AGENT, companyId: COMPANY };

  it(`refuses without an Official Business Account ("${TEAM_CHAT_NEEDS_OBA}")`, async () => {
    deps.getGroup.mockResolvedValue(null);
    deps.isOba.mockResolvedValue(false);

    expect(await ensureTeamChatGroup(agent, deps)).toEqual({
      status: "needs_oba",
      message: TEAM_CHAT_NEEDS_OBA,
    });
    expect(deps.createGroup).not.toHaveBeenCalled();
  });

  it("creates a pending group once and waits for the lifecycle webhook", async () => {
    deps.getGroup.mockResolvedValue(null);
    deps.createGroup.mockResolvedValue({
      success: true,
      requestId: "REQ9",
      groupId: null,
      inviteLink: null,
    });
    deps.saveGroup.mockImplementation(async (input: Record<string, unknown>) =>
      group({ ...input, status: "pending", groupId: null, inviteLink: null } as never),
    );

    expect(await ensureTeamChatGroup(agent, deps)).toEqual({ status: "pending" });
    expect(deps.createGroup).toHaveBeenCalledWith(SENDER, {
      subject: "Acme GmbH handoff",
      description: expect.any(String),
    });
    expect(deps.saveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", createRequestId: "REQ9", phoneNumberId: "PNID1" }),
    );
  });

  it("returns an active group's invite link without creating another", async () => {
    expect(await ensureTeamChatGroup(agent, deps)).toEqual({
      status: "active",
      inviteLink: "https://chat.whatsapp.com/ABC",
    });
    expect(deps.createGroup).not.toHaveBeenCalled();
  });

  it("does not leak another company's agent", async () => {
    deps.isCompanyAgent.mockResolvedValue(false);
    expect(await ensureTeamChatGroup(agent, deps)).toEqual({ status: "not_found" });
  });

  it("validates the internal request body", async () => {
    expect((await handleTeamChatGroupRequest({ agentId: "x" }, deps)).status).toBe(400);
    deps.isOba.mockResolvedValue(false);
    const res = await handleTeamChatGroupRequest({ agentId: AGENT, companyId: COMPANY }, deps);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ status: "needs_oba", message: TEAM_CHAT_NEEDS_OBA });
  });
});

describe("handleTeamChatLifecycle", () => {
  it("activates the pending group and fetches a missing invite link", async () => {
    deps.settleGroupCreate.mockResolvedValue(group({ inviteLink: null }));

    const outcome = await handleTeamChatLifecycle(
      {
        phoneNumberId: "PNID1",
        type: "group_create",
        groupId: GROUP_ID,
        requestId: "REQ1",
        inviteLink: null,
        subject: "Acme GmbH handoff",
        error: null,
      },
      deps,
    );

    expect(outcome).toBe("activated");
    expect(deps.setInviteLink).toHaveBeenCalledWith(AGENT, "https://chat.whatsapp.com/NEW", NOW);
  });

  it("ignores other lifecycle types", async () => {
    expect(
      await handleTeamChatLifecycle(
        {
          phoneNumberId: "PNID1",
          type: "group_delete",
          groupId: GROUP_ID,
          requestId: null,
          inviteLink: null,
          subject: null,
          error: null,
        },
        deps,
      ),
    ).toBe("ignored");
    expect(deps.settleGroupCreate).not.toHaveBeenCalled();
  });
});

describe("handleTeamChatWebhook", () => {
  it("routes a whole mocked webhook body and counts outcomes", async () => {
    deps.findQuestion.mockResolvedValue(question());
    const res = await handleTeamChatWebhook(
      groupWebhook({ text: { body: "Yes" }, context: { id: "wamid.Q1" } }),
      deps,
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ answered: 1, ignored: 0 });
  });
});

describe("checkTeamChatAvailability", () => {
  const agent = { id: AGENT, companyId: COMPANY };

  it("is available on an Official Business Account sender, without creating a group", async () => {
    expect(await checkTeamChatAvailability(agent, deps)).toEqual({ available: true });
    expect(deps.createGroup).not.toHaveBeenCalled();
    expect(deps.saveGroup).not.toHaveBeenCalled();
  });

  it("is unavailable without an Official Business Account", async () => {
    deps.isOba.mockResolvedValue(false);
    expect(await checkTeamChatAvailability(agent, deps)).toEqual({
      available: false,
      reason: "needs_oba",
      message: TEAM_CHAT_NEEDS_OBA,
    });
  });

  it("is unavailable without a WhatsApp sender", async () => {
    deps.findStaffSender.mockResolvedValue(null);
    expect(await checkTeamChatAvailability(agent, deps)).toEqual({
      available: false,
      reason: "no_sender",
      message: TEAM_CHAT_NEEDS_OBA,
    });
    expect(deps.isOba).not.toHaveBeenCalled();
  });

  it("does not leak another company's agent", async () => {
    deps.isCompanyAgent.mockResolvedValue(false);
    const res = await handleTeamChatAvailabilityRequest({ agentId: AGENT, companyId: COMPANY }, deps);
    expect(res.status).toBe(404);
  });

  it("answers 200 with the availability and validates the body", async () => {
    expect((await handleTeamChatAvailabilityRequest({ agentId: "x" }, deps)).status).toBe(400);
    const res = await handleTeamChatAvailabilityRequest({ agentId: AGENT, companyId: COMPANY }, deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ available: true });
  });
});
