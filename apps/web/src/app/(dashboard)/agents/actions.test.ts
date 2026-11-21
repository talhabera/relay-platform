import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-server";
import {
  createCustomerAgent,
  updateCustomerAgent,
  deleteCustomerAgent,
  createChannel as createChannelOp,
  createIntegration as createIntegrationOp,
  createTextKnowledge,
} from "@relay/agent-ops";
import {
  createAgent,
  updateAgent,
  deleteAgent,
  createChannel,
  createIntegration,
  createKnowledgeEntry,
} from "./actions";

vi.mock("@relay/agent-ops", () => ({
  createCustomerAgent: vi.fn(),
  updateCustomerAgent: vi.fn(),
  deleteCustomerAgent: vi.fn(),
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  createTextKnowledge: vi.fn(),
  beginWebsiteKnowledge: vi.fn(),
  completeWebsiteKnowledge: vi.fn(),
  failWebsiteKnowledge: vi.fn(),
  updateKnowledge: vi.fn(),
  deleteKnowledge: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockSession = {
  user: { id: "owner-1", name: "Owner", email: "owner@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";

describe("agents/actions delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockSession as never);
  });

  it("delegates createAgent to agent-ops with session user id", async () => {
    vi.mocked(createCustomerAgent).mockResolvedValue({ id: agentId });

    const result = await createAgent({
      name: "Support Bot",
      companyId,
    });

    expect(createCustomerAgent).toHaveBeenCalledWith("owner-1", {
      name: "Support Bot",
      companyId,
    });
    expect(result).toEqual({ id: agentId });
  });

  it("delegates updateAgent to agent-ops", async () => {
    await updateAgent(agentId, { name: "Updated Bot" });

    expect(updateCustomerAgent).toHaveBeenCalledWith("owner-1", agentId, {
      name: "Updated Bot",
    });
  });

  it("delegates deleteAgent to agent-ops", async () => {
    await deleteAgent(agentId);

    expect(deleteCustomerAgent).toHaveBeenCalledWith("owner-1", agentId);
  });

  it("delegates createChannel to agent-ops", async () => {
    vi.mocked(createChannelOp).mockResolvedValue({ id: "channel-1" });

    const result = await createChannel({
      name: "Widget",
      type: "widget",
      agentId,
    });

    expect(createChannelOp).toHaveBeenCalledWith("owner-1", {
      name: "Widget",
      type: "widget",
      agentId,
    });
    expect(result).toEqual({ id: "channel-1" });
  });

  it("delegates createIntegration to agent-ops", async () => {
    vi.mocked(createIntegrationOp).mockResolvedValue({ id: "integration-1" });

    const result = await createIntegration({
      name: "Shopify",
      type: "shopify",
      companyId,
    });

    expect(createIntegrationOp).toHaveBeenCalledWith("owner-1", {
      name: "Shopify",
      type: "shopify",
      companyId,
    });
    expect(result).toEqual({ id: "integration-1" });
  });

  it("delegates createKnowledgeEntry to agent-ops", async () => {
    vi.mocked(createTextKnowledge).mockResolvedValue({ id: "knowledge-1" });

    const result = await createKnowledgeEntry({
      name: "FAQ",
      agentId,
      companyId,
      type: "api",
      content: "Answer 1",
    });

    expect(createTextKnowledge).toHaveBeenCalledWith("owner-1", {
      name: "FAQ",
      agentId,
      companyId,
      type: "api",
      content: "Answer 1",
    });
    expect(result).toEqual({ id: "knowledge-1" });
  });
});
