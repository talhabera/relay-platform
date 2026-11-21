import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireLeadSession,
  acceptBorderlineLead,
  rejectBorderlineLead,
  excludeLead,
  moveLeadStatus,
  addLeadPayment,
  removeLeadPayment,
  revalidatePath,
} = vi.hoisted(() => ({
  requireLeadSession: vi.fn(),
  acceptBorderlineLead: vi.fn(),
  rejectBorderlineLead: vi.fn(),
  excludeLead: vi.fn(),
  moveLeadStatus: vi.fn(),
  addLeadPayment: vi.fn(),
  removeLeadPayment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/leads/session-access", () => ({ requireLeadSession }));
vi.mock("@/lib/leads", () => ({
  acceptBorderlineLead,
  rejectBorderlineLead,
  excludeLead,
  moveLeadStatus,
  addLeadPayment,
  removeLeadPayment,
  LEAD_PAYMENT_KINDS: ["deposit", "balance", "setup", "monthly"],
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { applyLeadAction } from "./actions";

const CHAT = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  requireLeadSession.mockResolvedValue({
    userId: "user-1",
    chatId: CHAT,
    window: { companyId: "company-1", from: new Date(), to: new Date() },
  });
  for (const fn of [acceptBorderlineLead, rejectBorderlineLead, excludeLead, moveLeadStatus, addLeadPayment, removeLeadPayment]) {
    fn.mockResolvedValue({ ok: true });
  }
});

describe("applyLeadAction", () => {
  it("accepts borderline leads as the person, on the session's company", async () => {
    const result = await applyLeadAction({ chatId: CHAT, action: "accept", leadIds: [L1, L2] });

    expect(requireLeadSession).toHaveBeenCalledWith(CHAT);
    expect(acceptBorderlineLead).toHaveBeenCalledWith({ companyId: "company-1", userId: "user-1", leadId: L1 });
    expect(acceptBorderlineLead).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ done: 2, failed: 0 });
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });

  it("passes the reason on reject and exclude, and counts refused leads", async () => {
    excludeLead.mockResolvedValueOnce({ ok: false, reason: "not_allowed" });

    const result = await applyLeadAction({ chatId: CHAT, action: "exclude", leadIds: [L1, L2, L1], reason: "Too small" });

    expect(excludeLead).toHaveBeenCalledTimes(2);
    expect(excludeLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: L1, reason: "Too small" }));
    expect(result).toEqual({ done: 1, failed: 1 });

    await applyLeadAction({ chatId: CHAT, action: "reject", leadIds: [L1] });
    expect(rejectBorderlineLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: L1 }));
  });

  it("writes nothing when the viewer cannot steer the session", async () => {
    requireLeadSession.mockRejectedValue(new Error("Unauthorized: no"));

    await expect(applyLeadAction({ chatId: CHAT, action: "accept", leadIds: [L1] })).rejects.toThrow("Unauthorized");
    expect(acceptBorderlineLead).not.toHaveBeenCalled();
  });

  it("rejects bad input before the gate", async () => {
    await expect(applyLeadAction({ chatId: CHAT, action: "accept", leadIds: [] })).rejects.toThrow();
    await expect(
      applyLeadAction({ chatId: CHAT, action: "delete" as "accept", leadIds: [L1] }),
    ).rejects.toThrow();
    expect(requireLeadSession).not.toHaveBeenCalled();
  });

  it("move calls moveLeadStatus as the person, on the session's company", async () => {
    const result = await applyLeadAction({
      chatId: CHAT,
      action: "move",
      leadIds: [L1],
      toStatus: "won",
      salePackage: "website",
      saleAmountMinor: 8_000_000,
    });
    expect(moveLeadStatus).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      leadId: L1,
      toStatus: "won",
      salePackage: "website",
      saleAmountMinor: 8_000_000,
      reason: undefined,
      reopen: undefined,
    });
    expect(result).toEqual({ done: 1, failed: 0 });
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });

  it("move without toStatus fails zod; a target outside the funnel too", async () => {
    await expect(applyLeadAction({ chatId: CHAT, action: "move", leadIds: [L1] })).rejects.toThrow();
    await expect(
      applyLeadAction({ chatId: CHAT, action: "move", leadIds: [L1], toStatus: "delivered" as "won" }),
    ).rejects.toThrow();
    expect(requireLeadSession).not.toHaveBeenCalled();
  });

  it("won without sale fields counts as failed, not done", async () => {
    moveLeadStatus.mockResolvedValue({ ok: false, reason: "sale_required" });
    const result = await applyLeadAction({ chatId: CHAT, action: "move", leadIds: [L1], toStatus: "won" });
    expect(result).toEqual({ done: 0, failed: 1 });
  });

  it("payment_add and payment_remove call the payment functions as the person", async () => {
    await applyLeadAction({
      chatId: CHAT,
      action: "payment_add",
      leadIds: [L1],
      kind: "deposit",
      amountMinor: 4_000_000,
      receivedOn: "2026-11-05",
    });
    expect(addLeadPayment).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      leadId: L1,
      kind: "deposit",
      amountMinor: 4_000_000,
      receivedOn: "2026-11-05",
    });

    const result = await applyLeadAction({ chatId: CHAT, action: "payment_remove", leadIds: [L1], paymentId: "p-1" });
    expect(removeLeadPayment).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      leadId: L1,
      paymentId: "p-1",
    });
    expect(result).toEqual({ done: 1, failed: 0 });
  });

  it("payment actions without their fields, or for more than one lead, fail zod", async () => {
    await expect(
      applyLeadAction({ chatId: CHAT, action: "payment_add", leadIds: [L1], kind: "deposit", amountMinor: 100 }),
    ).rejects.toThrow();
    await expect(
      applyLeadAction({ chatId: CHAT, action: "payment_add", leadIds: [L1], amountMinor: 100, receivedOn: "2026-11-05" }),
    ).rejects.toThrow();
    await expect(applyLeadAction({ chatId: CHAT, action: "payment_remove", leadIds: [L1] })).rejects.toThrow();
    await expect(
      applyLeadAction({ chatId: CHAT, action: "payment_remove", leadIds: [L1, L2], paymentId: "p-1" }),
    ).rejects.toThrow();
    expect(requireLeadSession).not.toHaveBeenCalled();
    expect(addLeadPayment).not.toHaveBeenCalled();
  });
});
