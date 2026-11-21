import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { checkpointArtifactHash } from "@relay/db";
import {
  CheckpointExecutionError,
  checkpointActionBodySchema,
  executeCheckpoint,
  isDraftChanged,
  markCheckpointsStaleForArtifact,
} from "./checkpoint-actions";

const payload = {
  kind: "outreach" as const,
  channel: "copy" as const,
  recipient: "ada@acme.com",
  body: "Note",
  reason: "Fit",
  recordName: "Acme",
  domain: null,
};

describe("isDraftChanged", () => {
  it("is false for a card with no hash (proposed before S10)", () => {
    expect(isDraftChanged({ artifactHash: null, payload })).toBe(false);
  });

  it("compares the stored hash with the current draft", () => {
    const artifactHash = checkpointArtifactHash(payload);
    expect(isDraftChanged({ artifactHash, payload })).toBe(false);
    expect(
      isDraftChanged({ artifactHash, payload: { ...payload, body: "Edited" } }),
    ).toBe(true);
  });
});

describe("executeCheckpoint", () => {
  it("returns the copy path for outreach", async () => {
    await expect(
      executeCheckpoint({ id: "cp-1", kind: "outreach", payload, companyId: "co-1" }),
    ).resolves.toEqual({
      mode: "copy",
      channel: "copy",
      recipient: "ada@acme.com",
      body: "Note",
    });
  });

  describe("email outreach (S73 Gmail)", () => {
    const email = {
      ...payload,
      channel: "email" as const,
      subject: "Quick idea",
    };

    it("falls back to copy and send yourself without a connected Gmail", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      try {
        for (const row of [undefined, { status: "error" }, { status: "disconnected" }]) {
          vi.mocked(db.query.integrations.findFirst).mockResolvedValueOnce(row as never);
          await expect(
            executeCheckpoint({ id: "cp-1", kind: "outreach", payload: email, companyId: "co-1" }),
          ).resolves.toMatchObject({ mode: "copy", channel: "email", subject: "Quick idea" });
        }
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("sends from Gmail through the worker when Google Workspace is connected", async () => {
      vi.mocked(db.query.integrations.findFirst).mockResolvedValueOnce({
        status: "connected",
      } as never);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ mode: "sent", provider: "gmail", messageId: "m-1" }), {
          status: 200,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        await expect(
          executeCheckpoint({ id: "cp-7", kind: "outreach", payload: email, companyId: "co-1" }),
        ).resolves.toEqual({ mode: "sent", provider: "gmail", messageId: "m-1" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://worker:3001/internal/outreach-send");
        expect(JSON.parse(init.body)).toEqual({ checkpointId: "cp-7" });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("fails the card with Gmail's reason so Retry is offered", async () => {
      vi.mocked(db.query.integrations.findFirst).mockResolvedValueOnce({
        status: "connected",
      } as never);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: "Gmail answered 429" }), { status: 502 }),
        ),
      );
      try {
        await expect(
          executeCheckpoint({ id: "cp-7", kind: "outreach", payload: email, companyId: "co-1" }),
        ).rejects.toThrow("Gmail answered 429");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("never sends a whatsapp or copy outreach from Gmail", async () => {
      vi.mocked(db.query.integrations.findFirst).mockResolvedValue({
        status: "connected",
      } as never);
      await expect(
        executeCheckpoint({
          id: "cp-1",
          kind: "outreach",
          payload: { ...payload, channel: "whatsapp" },
          companyId: "co-1",
        }),
      ).resolves.toMatchObject({ mode: "copy", channel: "whatsapp" });
      vi.mocked(db.query.integrations.findFirst).mockReset();
    });
  });

  const delivery = {
    kind: "lead_delivery" as const,
    leadId: "lead-1",
    channel: "whatsapp" as const,
    recipient: "+905551112233",
    summary: "Ayse, villa",
    reason: "fit 82",
  };

  it("asks the worker to send a lead delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mode: "sent", messageId: "wamid-1" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        executeCheckpoint({ id: "cp-9", kind: "lead_delivery", payload: delivery, companyId: "co-1" }),
      ).resolves.toEqual({ mode: "sent", messageId: "wamid-1" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://worker:3001/internal/lead-delivery");
      expect(init.headers.Authorization).toBe("Bearer test-secret");
      expect(JSON.parse(init.body)).toEqual({ checkpointId: "cp-9" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails the card with the worker's reason when the send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "No active WhatsApp channel" }), {
          status: 422,
        }),
      ),
    );
    try {
      await expect(
        executeCheckpoint({ id: "cp-9", kind: "lead_delivery", payload: delivery, companyId: "co-1" }),
      ).rejects.toThrow("No active WhatsApp channel");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("ad_change (08b2)", () => {
    const adChange = {
      kind: "ad_change" as const,
      mode: "change" as const,
      changeId: "chg-1",
      platform: "google" as const,
      accountId: "acc-1",
      campaignId: "cmp-1",
      campaignName: "Villa",
      command: {
        platform: "google" as const,
        accountId: "acc-1",
        campaignId: "cmp-1",
        action: "set_daily_budget" as const,
        afterMinor: 60_000,
      },
      before: { dailyBudgetMinor: 50_000 },
      after: { dailyBudgetMinor: 60_000 },
      deltaMinor: 10_000,
      dailyTotalAfterMinor: 60_000,
      reason: { text: "CPL düştü", metric: "cpl", value: 80, threshold: 100 },
      expiresAt: "2026-11-07T10:00:00.000Z",
      executionMode: "api" as const,
    };

    it("runs the change on the worker and returns its result", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ outcome: "applied", changeId: "chg-9" }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        await expect(
          executeCheckpoint({ id: "cp-7", kind: "ad_change", payload: adChange, companyId: "co-1" }),
        ).resolves.toEqual({ outcome: "applied", changeId: "chg-9" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://worker:3001/internal/ad-change");
        expect(init.headers.Authorization).toBe("Bearer test-secret");
        expect(JSON.parse(init.body)).toEqual({ checkpointId: "cp-7" });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("throws CheckpointExecutionError on { ok: false } so the card lands in failed", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: "Günlük reklam limiti aşılacağı için reddedildi." }), {
            status: 409,
          }),
        ),
      );
      try {
        const run = executeCheckpoint({ id: "cp-7", kind: "ad_change", payload: adChange, companyId: "co-1" });
        await expect(run).rejects.toBeInstanceOf(CheckpointExecutionError);
        await expect(run).rejects.toThrow("Günlük reklam limiti");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe("markCheckpointsStaleForArtifact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks pending cards stale and moves their sessions to needs_you", async () => {
    const sets: unknown[] = [];
    vi.mocked(db.update).mockImplementation(
      () =>
        ({
          set: (values: unknown) => {
            sets.push(values);
            const result = Promise.resolve(undefined) as Promise<undefined> & {
              returning: () => Promise<unknown[]>;
            };
            result.returning = async () => [
              { id: "c1", chatId: "chat-1" },
              { id: "c2", chatId: "chat-1" },
              { id: "c3", chatId: null },
            ];
            return { where: () => result };
          },
        }) as never,
    );
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: "c1" },
      { id: "c2" },
    ] as never);
    const now = new Date("2026-10-01T00:00:00.000Z");

    const ids = await markCheckpointsStaleForArtifact({
      companyId: "co-1",
      artifactHash: "abc",
      now,
    });

    expect(ids).toEqual(["c1", "c2", "c3"]);
    expect(sets[0]).toMatchObject({ status: "stale" });
    expect(sets.slice(1)).toEqual([{ status: "needs_you", lastActivityAt: now }]);
  });
});

describe("checkpointActionBodySchema", () => {
  it("maps reject to discard", () => {
    expect(checkpointActionBodySchema.parse({ action: "reject" })).toEqual({
      action: "discard",
      feedback: undefined,
    });
  });
});
