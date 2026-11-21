import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ requireAgentAccess: vi.fn() }));
vi.mock("./settings", () => ({ saveAgentHandoffSettings: vi.fn() }));
vi.mock("@/lib/worker-proxy", () => ({
  requestRecipientConfirmationOnWorker: vi.fn(),
}));
vi.mock("./requests", () => ({
  answerHandoffRequest: vi.fn(),
  closeHandoffLink: vi.fn(),
  handBackHandoffRequest: vi.fn(),
  sendTakeoverMessage: vi.fn(),
  takeOverHandoffRequest: vi.fn(),
}));

import { requireAgentAccess } from "@/lib/authorization";
import { answerHandoff, updateHandoffSettings } from "./actions";
import { answerHandoffRequest } from "./requests";
import { saveAgentHandoffSettings } from "./settings";
import { requestRecipientConfirmationOnWorker } from "@/lib/worker-proxy";
import type { HandoffSettingsInput } from "./validators";

const INPUT: HandoffSettingsInput = {
  mode: "quick_answer",
  triggers: {
    priceNotListed: true,
    asksForPerson: true,
    complaintOrRefund: true,
    lowConfidence: true,
  },
  recipientName: "Markus",
  recipientWhatsapp: "+4915123456789",
  expiryMinutes: 120,
  defaultReply: "agent",
  recipientCanTakeOver: false,
  waitingText: "",
  ifNobodyAnswers: "reply_here",
};

const agentOf = (kind: "customer" | "operator") =>
  ({ agent: { id: "agent-1", companyId: "company-1", kind } }) as unknown as Awaited<
    ReturnType<typeof requireAgentAccess>
  >;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveAgentHandoffSettings).mockResolvedValue({
    settings: { agentId: "agent-1" },
    needsConfirmation: false,
  } as unknown as Awaited<ReturnType<typeof saveAgentHandoffSettings>>);
});

describe("updateHandoffSettings", () => {
  it("saves for the authorised customer agent", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue(agentOf("customer"));
    await updateHandoffSettings("agent-1", INPUT);
    expect(saveAgentHandoffSettings).toHaveBeenCalledWith(
      expect.objectContaining({ id: "agent-1", companyId: "company-1" }),
      expect.objectContaining({ recipientWhatsapp: "+4915123456789" }),
    );
  });

  it("refuses operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue(agentOf("operator"));
    await expect(updateHandoffSettings("agent-1", INPUT)).rejects.toThrow();
    expect(saveAgentHandoffSettings).not.toHaveBeenCalled();
  });

  it("validates before saving", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue(agentOf("customer"));
    await expect(
      updateHandoffSettings("agent-1", { ...INPUT, recipientWhatsapp: "123" }),
    ).rejects.toThrow();
    expect(saveAgentHandoffSettings).not.toHaveBeenCalled();
  });
});

describe("updateHandoffSettings recipient confirmation", () => {
  const saved = (needsConfirmation: boolean) =>
    ({ settings: { agentId: "agent-1" }, needsConfirmation }) as unknown as Awaited<
      ReturnType<typeof saveAgentHandoffSettings>
    >;

  beforeEach(() => {
    vi.mocked(requireAgentAccess).mockResolvedValue(agentOf("customer"));
  });

  it("asks the worker to confirm a new number and reports the outcome", async () => {
    vi.mocked(saveAgentHandoffSettings).mockResolvedValue(saved(true));
    vi.mocked(requestRecipientConfirmationOnWorker).mockResolvedValue("sent");

    const result = await updateHandoffSettings("agent-1", INPUT);

    expect(requestRecipientConfirmationOnWorker).toHaveBeenCalledWith({
      agentId: "agent-1",
      companyId: "company-1",
    });
    expect(result.confirmation).toBe("sent");
    expect(result.needsConfirmation).toBe(true);
  });

  it.each(["not_needed", "not_found", "failed", "unavailable"] as const)(
    "keeps the save when the worker answers %s",
    async (outcome) => {
      vi.mocked(saveAgentHandoffSettings).mockResolvedValue(saved(true));
      vi.mocked(requestRecipientConfirmationOnWorker).mockResolvedValue(outcome);

      const result = await updateHandoffSettings("agent-1", INPUT);

      expect(result.settings).toEqual({ agentId: "agent-1" });
      expect(result.confirmation).toBe(outcome);
    },
  );

  it("does not poke the worker when the number did not change", async () => {
    vi.mocked(saveAgentHandoffSettings).mockResolvedValue(saved(false));

    const result = await updateHandoffSettings("agent-1", INPUT);

    expect(requestRecipientConfirmationOnWorker).not.toHaveBeenCalled();
    expect(result.confirmation).toBeNull();
  });
});

describe("answerHandoff", () => {
  it("validates the answer before using the token", async () => {
    await expect(answerHandoff("t", { text: "", replyMode: "person" })).rejects.toThrow();
    expect(answerHandoffRequest).not.toHaveBeenCalled();
  });
});
