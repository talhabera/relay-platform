import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireAgentAccess } from "../auth/access";
import {
  createChannel,
  deleteChannel,
  listChannels,
  setChannelFlag,
  updateChannel,
} from "./channels";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agents: { findFirst: vi.fn() },
        channels: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireAgentAccess: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";

const customerAgent = {
  id: agentId,
  companyId,
  kind: "customer" as const,
};

const operatorAgent = {
  id: agentId,
  companyId,
  kind: "operator" as const,
};

const channelRow = {
  id: channelId,
  name: "WhatsApp",
  type: "whatsapp" as const,
  agentId,
  status: "active" as const,
  config: { apiKey: "secret123", phoneNumberId: "+15551234567" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("listChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("masks channel secrets on list", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(db.query.channels.findMany).mockResolvedValue([channelRow] as never);

    const result = await listChannels("owner-1", agentId);

    expect(result.channels[0]?.config.apiKey).toBe("secr****");
    expect(JSON.stringify(result)).not.toContain("secret123");
    expect(result.channels[0]?.config.phoneNumberId).toBe("+15551234567");
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", agentId);
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(listChannels("owner-1", agentId)).rejects.toThrow(
      "Only customer agents in this company can be accessed",
    );
    expect(db.query.channels.findMany).not.toHaveBeenCalled();
  });
});

describe("createChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores raw secrets on create", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: channelId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createChannel("owner-1", {
      name: "WhatsApp",
      type: "whatsapp",
      agentId,
      config: { apiKey: "secret123" },
    });

    expect(result).toEqual({ id: channelId });
    expect(values).toHaveBeenCalledWith({
      name: "WhatsApp",
      type: "whatsapp",
      agentId,
      config: { apiKey: "secret123" },
    });
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(
      createChannel("owner-1", {
        name: "WhatsApp",
        type: "whatsapp",
        agentId,
      }),
    ).rejects.toThrow("Only customer agents in this company can be accessed");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("updateChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a channel with raw config", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(channelRow as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateChannel("owner-1", channelId, {
      config: { apiKey: "new-secret456" },
    });

    expect(result).toEqual({ id: channelId });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { apiKey: "new-secret456" },
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("rejects operator agents", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(channelRow as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(
      updateChannel("owner-1", channelId, { name: "Renamed" }),
    ).rejects.toThrow("Only customer agents in this company can be accessed");
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("setChannelFlag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The whole point of the function: `config` is a whole-jsonb replace, so a
  // naive updateChannel({ config: { autoReply: true } }) would wipe the
  // credentials and silently disconnect the channel.
  it("merges the flag into the existing config instead of replacing it", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...channelRow,
      config: {
        apiKey: "secret123",
        phoneNumberId: "+15551234567",
        accessToken: "EAAtoken",
      },
    } as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await setChannelFlag("owner-1", channelId, "autoReply", true);

    expect(result).toEqual({ id: channelId });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          apiKey: "secret123",
          phoneNumberId: "+15551234567",
          accessToken: "EAAtoken",
          autoReply: true,
        },
        updatedAt: expect.any(Date),
      }),
    );
    expect(where).toHaveBeenCalled();
  });

  it("writes false without dropping the credentials", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...channelRow,
      config: { accessToken: "EAAtoken", autoReply: true },
    } as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    await setChannelFlag("owner-1", channelId, "autoReply", false);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { accessToken: "EAAtoken", autoReply: false },
      }),
    );
  });

  it("rejects operator agents", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(channelRow as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(
      setChannelFlag("owner-1", channelId, "autoReply", true),
    ).rejects.toThrow("Only customer agents in this company can be accessed");
    expect(db.update).not.toHaveBeenCalled();
  });

  // `flag` is typed as a union, but setChannelFlag is reachable from a
  // "use server" action where the type checker has already been bypassed by
  // attacker-supplied JSON. The runtime guard, not the type, is what stops
  // an arbitrary key merging into config.
  it("rejects an unknown flag and writes nothing", async () => {
    await expect(
      setChannelFlag("owner-1", channelId, "accessToken" as never, true),
    ).rejects.toThrow("Unknown channel flag");

    expect(requireAgentAccess).not.toHaveBeenCalled();
    expect(db.query.channels.findFirst).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean enabled value and writes nothing", async () => {
    await expect(
      setChannelFlag("owner-1", channelId, "autoReply", "true" as never),
    ).rejects.toThrow("Unknown channel flag");

    expect(db.update).not.toHaveBeenCalled();
  });

  it("merges autoCommentReply without touching autoReply", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...channelRow,
      config: { accessToken: "IGQVJtoken", autoReply: true },
    } as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    await setChannelFlag("owner-1", channelId, "autoCommentReply", true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          accessToken: "IGQVJtoken",
          autoReply: true,
          autoCommentReply: true,
        },
      }),
    );
  });
});

describe("deleteChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a channel", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(channelRow as never);
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    const result = await deleteChannel("owner-1", channelId);

    expect(result).toEqual({ id: channelId });
    expect(where).toHaveBeenCalled();
  });
});

describe("routing key conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
  });

  /** What postgres.js throws when a unique index refuses a row. */
  function uniqueViolation(constraint: string) {
    const error = new Error(
      `duplicate key value violates unique constraint "${constraint}"`,
    ) as Error & { code: string; constraint_name: string };
    error.code = "23505";
    error.constraint_name = constraint;
    return error;
  }

  it("says which account is taken when a create collides", async () => {
    const returning = vi.fn().mockRejectedValue(
      uniqueViolation("channels_instagram_account_uidx"),
    );
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({ returning })),
    } as never);

    await expect(
      createChannel("owner-1", {
        name: "Instagram",
        type: "instagram",
        agentId,
        config: { accountId: "17841400000000000", accessToken: "IGQVJtoken" },
      }),
    ).rejects.toThrow(/Instagram account is already connected/);
  });

  it("says which number is taken when an update collides", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(
      channelRow as never,
    );
    const where = vi.fn().mockRejectedValue(
      uniqueViolation("channels_whatsapp_phone_number_uidx"),
    );
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn(() => ({ where })),
    } as never);

    await expect(
      updateChannel("owner-1", channelId, {
        config: { phoneNumberId: "123456789012345" },
      }),
    ).rejects.toThrow(/WhatsApp number is already connected/);
  });

  it("lets an unrelated database error through unchanged", async () => {
    const returning = vi.fn().mockRejectedValue(new Error("connection lost"));
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({ returning })),
    } as never);

    await expect(
      createChannel("owner-1", { name: "WhatsApp", type: "whatsapp", agentId }),
    ).rejects.toThrow("connection lost");
  });
});
