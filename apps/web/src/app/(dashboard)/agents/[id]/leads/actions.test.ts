import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAgentAccess, revalidatePath } = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ requireAgentAccess }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { db } from "@/db";
import { collectColumnNames } from "@/test-utils/column-names";
import { updateLeadNotifyNumber } from "./actions";

const where = vi.fn();
const set = vi.fn(() => ({ where }));

beforeEach(() => {
  vi.clearAllMocks();
  (db.update as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ set });
  requireAgentAccess.mockResolvedValue({
    session: {},
    agent: { id: "agent-1", companyId: "company-1", kind: "customer" },
  });
});

describe("updateLeadNotifyNumber", () => {
  it("stores the parsed number on the agent's own company", async () => {
    const result = await updateLeadNotifyNumber("agent-1", { whatsapp: "+905551234567" });

    expect(result).toEqual({ whatsapp: "+905551234567" });
    expect(set).toHaveBeenCalledWith({ leadNotifyWhatsapp: "+905551234567" });
    expect(collectColumnNames(where.mock.calls[0][0])).toContain("id");
    expect(revalidatePath).toHaveBeenCalledWith("/agents/agent-1/leads");
  });

  it("clears the number on an empty value", async () => {
    await updateLeadNotifyNumber("agent-1", { whatsapp: "" });

    expect(set).toHaveBeenCalledWith({ leadNotifyWhatsapp: null });
  });

  it("rejects a malformed number without touching the database", async () => {
    await expect(updateLeadNotifyNumber("agent-1", { whatsapp: "0555" })).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("does nothing when the caller does not own the agent", async () => {
    requireAgentAccess.mockRejectedValue(new Error("Unauthorized"));

    await expect(updateLeadNotifyNumber("agent-1", { whatsapp: "+905551234567" })).rejects.toThrow("Unauthorized");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses operator agents", async () => {
    requireAgentAccess.mockResolvedValue({
      session: {},
      agent: { id: "agent-1", companyId: "company-1", kind: "operator" },
    });

    await expect(updateLeadNotifyNumber("agent-1", { whatsapp: "+905551234567" })).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });
});
