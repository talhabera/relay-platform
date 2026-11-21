import { describe, expect, it } from "vitest";
import { selectTools } from "./tools";

const LEAD_CAPTURE = {
  agentId: "agent-1",
  companyId: "company-1",
  getChatId: () => "chat-1",
  intake: [{ key: "need", label: "Need", required: true }],
};

describe("selectTools record_lead", () => {
  it("is absent unless the call site opts in", () => {
    expect(Object.keys(selectTools([], "agent-1", []))).not.toContain("record_lead");
  });

  it("registers for a public path that may not send messages", () => {
    const keys = Object.keys(
      selectTools([], "agent-1", [], { allowSendTools: false, leadCapture: LEAD_CAPTURE }),
    );

    expect(keys).toContain("record_lead");
    expect(keys).not.toContain("captureLead");
    expect(keys).not.toContain("sendPlatformMessage");
  });
});

describe("selectTools ask_human", () => {
  const ASK_HUMAN = {
    agentId: "agent-1",
    companyId: "company-1",
    getChatId: () => "chat-1",
    waitingText: "Asking a colleague…",
  };

  it("is absent unless the call site opts in", () => {
    expect(Object.keys(selectTools([], "agent-1", []))).not.toContain("ask_human");
  });

  it("registers on a public path without opening send tools", () => {
    const keys = Object.keys(
      selectTools([], "agent-1", [], { allowSendTools: false, askHuman: ASK_HUMAN }),
    );

    expect(keys).toContain("ask_human");
    expect(keys).not.toContain("sendPlatformMessage");
  });
});
