import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import { pingOperatorConnector } from "@/lib/company/connector-ping";
import {
  connectOperatorConnector,
  disconnectOperatorConnector,
  validateOperatorConnector,
} from "./connector-actions";
import { revalidatePath } from "next/cache";
import { resumeWaitingPackageSchedules } from "@relay/agent-ops/operator/packages";

vi.mock("@/lib/authorization", () => ({
  requireCompanyAccess: vi.fn(),
}));

vi.mock("@relay/agent-ops/operator/packages", () => ({
  resumeWaitingPackageSchedules: vi.fn(async () => []),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/company/connector-ping", () => ({
  pingOperatorConnector: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const ownerId = "owner-1";

const company = {
  id: companyId,
  name: "Acme",
  ownerId,
};

describe("connectOperatorConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
    vi.mocked(pingOperatorConnector).mockResolvedValue({ ok: true });
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue(undefined);
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);
  });

  it("requires company owner access", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(
      new Error("Unauthorized: You don't have access to this company"),
    );

    await expect(
      connectOperatorConnector({
        companyId,
        type: "hunter",
        hunterApiKey: "key",
      }),
    ).rejects.toThrow("Unauthorized");
    expect(pingOperatorConnector).not.toHaveBeenCalled();
  });

  it("upserts a connected hunter integration on successful ping", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await connectOperatorConnector({
      companyId,
      type: "hunter",
      hunterApiKey: "hunter-key",
    });

    expect(result).toEqual({ ok: true });
    expect(requireCompanyAccess).toHaveBeenCalledWith(companyId);
    expect(pingOperatorConnector).toHaveBeenCalledWith({
      type: "hunter",
      apiKey: "hunter-key",
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        type: "hunter",
        agentId: null,
        status: "connected",
        config: { hunter: { apiKey: "hunter-key" } },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/companies/${companyId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/connectors");
    expect(resumeWaitingPackageSchedules).toHaveBeenCalledWith(companyId);
  });

  it("stores error status when ping fails", async () => {
    vi.mocked(pingOperatorConnector).mockResolvedValue({
      ok: false,
      error: "http_401",
    });
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
    } as never);
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await connectOperatorConnector({
      companyId,
      type: "snov",
      snovClientId: "id",
      snovClientSecret: "secret",
    });

    expect(result).toEqual({ error: "http_401" });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: "http_401",
        config: {
          snov: { clientId: "id", clientSecret: "secret" },
        },
      }),
    );
  });
});

describe("connectOperatorConnector key edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
    vi.mocked(pingOperatorConnector).mockResolvedValue({ ok: true });
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue(undefined);
  });

  it("refuses unavailable catalog connectors without checking or storing anything", async () => {
    const result = await connectOperatorConnector({
      companyId,
      type: "meta" as never,
      hunterApiKey: "key",
    });

    expect(result).toEqual({ error: "Meta isn't available yet" });
    expect(pingOperatorConnector).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses types outside the connector catalog", async () => {
    const result = await connectOperatorConnector({
      companyId,
      type: "shopify" as never,
    });

    expect(result).toEqual({ error: "Unknown connector" });
    expect(pingOperatorConnector).not.toHaveBeenCalled();
  });

  it("keeps the working key when a replacement key fails the check", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
      status: "connected",
      config: { hunter: { apiKey: "old-key" } },
    } as never);
    vi.mocked(pingOperatorConnector).mockResolvedValue({
      ok: false,
      error: "http_401",
    });
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await connectOperatorConnector({
      companyId,
      type: "hunter",
      hunterApiKey: "bad-key",
    });

    expect(result).toEqual({ error: "http_401" });
    expect(pingOperatorConnector).toHaveBeenCalledWith({
      type: "hunter",
      apiKey: "bad-key",
    });
    expect(set).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("replaces the stored key when the new key passes the check", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
      status: "connected",
      config: { hunter: { apiKey: "old-key" } },
    } as never);
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await connectOperatorConnector({
      companyId,
      type: "hunter",
      hunterApiKey: "new-key",
    });

    expect(result).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        error: null,
        config: { hunter: { apiKey: "new-key" } },
        lastSyncAt: expect.any(Date),
      }),
    );
  });
});

describe("validateOperatorConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
    vi.mocked(pingOperatorConnector).mockResolvedValue({ ok: true });
  });

  it("requires company owner access", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(new Error("Unauthorized"));

    await expect(
      validateOperatorConnector({ companyId, type: "hunter" }),
    ).rejects.toThrow("Unauthorized");
    expect(pingOperatorConnector).not.toHaveBeenCalled();
  });

  it("re-checks the stored key and marks the connector connected", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
      status: "error",
      config: { snov: { clientId: "id", clientSecret: "secret" } },
    } as never);
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await validateOperatorConnector({ companyId, type: "snov" });

    expect(result).toEqual({ ok: true });
    expect(pingOperatorConnector).toHaveBeenCalledWith({
      type: "snov",
      clientId: "id",
      clientSecret: "secret",
    });
    expect(set).toHaveBeenCalledWith({
      status: "connected",
      error: null,
      lastSyncAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/connectors");
  });

  it("marks the connector errored when the stored key fails the check", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
      status: "connected",
      config: { googlePlaces: { apiKey: "key" } },
    } as never);
    vi.mocked(pingOperatorConnector).mockResolvedValue({ ok: false, error: "http_403" });
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await validateOperatorConnector({ companyId, type: "google_places" });

    expect(result).toEqual({ error: "http_403" });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "http_403" }),
    );
  });

  it("returns an error when no key is stored", async () => {
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "existing",
      status: "disconnected",
      config: {},
    } as never);

    const result = await validateOperatorConnector({ companyId, type: "hunter" });

    expect(result).toEqual({ error: "Hunter has no stored key" });
    expect(pingOperatorConnector).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses unavailable catalog connectors", async () => {
    const result = await validateOperatorConnector({
      companyId,
      type: "trustpilot" as never,
    });

    expect(result).toEqual({ error: "Trustpilot isn't available yet" });
    expect(pingOperatorConnector).not.toHaveBeenCalled();
  });
});

describe("disconnectOperatorConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);
  });

  it("clears config and marks disconnected", async () => {
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    await disconnectOperatorConnector({ companyId, type: "google_places" });

    expect(requireCompanyAccess).toHaveBeenCalledWith(companyId);
    expect(set).toHaveBeenCalledWith({
      status: "disconnected",
      config: {},
      error: null,
      updatedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/companies/${companyId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/connectors");
  });

  it("revokes Relay's Gmail access when Google Workspace is removed (S73)", async () => {
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);
    vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
      id: "int-g",
      config: { googleWorkspace: { refreshToken: "rt-1", email: "me@a.com", scope: "s" } },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await disconnectOperatorConnector({ companyId, type: "google_workspace" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({ body: "token=rt-1" }),
    );
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "disconnected", config: {} }));
  });

  it("refuses a type that is not an available connector", async () => {
    await expect(
      disconnectOperatorConnector({ companyId, type: "meta" as never }),
    ).rejects.toThrow("Unknown connector");
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("connectOperatorConnector with Google Workspace", () => {
  it("points to Google sign-in instead of taking a key", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
    await expect(
      connectOperatorConnector({ companyId, type: "google_workspace" as never }),
    ).resolves.toEqual({ error: "Google Workspace connects with Google sign-in" });
  });
});
