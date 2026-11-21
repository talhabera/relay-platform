import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireCompanyAccess } from "../auth/access";
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  updateIntegration,
} from "./integrations";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: { integrations: { findFirst: vi.fn(), findMany: vi.fn() } },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyAccess: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const integrationId = "33333333-3333-4333-8333-333333333333";

const integrationRow = {
  id: integrationId,
  name: "Slack",
  type: "slack" as const,
  companyId,
  agentId,
  status: "connected" as const,
  config: { apiKey: "secret123", webhookUrl: "https://hooks.slack.com/test" },
  error: null,
  lastSyncAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("listIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("masks integration secrets on list", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.integrations.findMany).mockResolvedValue([
      integrationRow,
    ] as never);

    const result = await listIntegrations("owner-1", companyId);

    expect(result.integrations[0]?.config.apiKey).toBe("secr****");
    expect(JSON.stringify(result)).not.toContain("secret123");
    expect(result.integrations[0]?.config.webhookUrl).toBe(
      "https://hooks.slack.com/test",
    );
    expect(requireCompanyAccess).toHaveBeenCalledWith("owner-1", companyId);
  });

  it("filters by agentId when provided", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.integrations.findMany).mockResolvedValue([
      integrationRow,
    ] as never);

    await listIntegrations("owner-1", companyId, agentId);

    expect(db.query.integrations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      }),
    );
  });
});

describe("createIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores raw secrets on create", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: integrationId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createIntegration("owner-1", {
      name: "Slack",
      type: "slack",
      companyId,
      agentId,
      config: { apiKey: "secret123" },
    });

    expect(result).toEqual({ id: integrationId });
    expect(values).toHaveBeenCalledWith({
      name: "Slack",
      type: "slack",
      companyId,
      agentId,
      config: { apiKey: "secret123" },
    });
  });
});

describe("updateIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates an integration with raw config", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue(
      integrationRow as never,
    );
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateIntegration("owner-1", integrationId, {
      config: { apiKey: "new-secret456" },
    });

    expect(result).toEqual({ id: integrationId });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { apiKey: "new-secret456" },
        updatedAt: expect.any(Date),
      }),
    );
  });
});

describe("deleteIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes an integration", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue(
      integrationRow as never,
    );
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    const result = await deleteIntegration("owner-1", integrationId);

    expect(result).toEqual({ id: integrationId });
    expect(where).toHaveBeenCalled();
  });
});
