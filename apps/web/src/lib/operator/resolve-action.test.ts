import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { chats, checkpoints, companyRecords } from "@/db/schema";
import { checkpointArtifactHash } from "@relay/db";
import { resolveCheckpoint } from "./resolve-action";

const { transitionLeadStatus, markLeadDelivered } = vi.hoisted(() => ({
  transitionLeadStatus: vi.fn(),
  markLeadDelivered: vi.fn(),
}));

vi.mock("@/lib/leads", () => ({ transitionLeadStatus, markLeadDelivered }));

const checkpointId = "bb0e8400-e29b-41d4-a716-446655440011";
const recordId = "aa0e8400-e29b-41d4-a716-446655440010";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const userId = "user-1";
const now = new Date("2026-08-31T12:00:00.000Z");

const payload = {
  kind: "outreach" as const,
  channel: "email" as const,
  recipient: "ada@acme.com",
  subject: "Hello Acme",
  body: "Tailored note",
  reason: "Good fit",
  recordName: "Acme",
  domain: "acme.com",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: checkpointId,
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    agentId,
    chatId: "chat-1",
    cronRunId: null,
    recordId,
    kind: "outreach" as const,
    payload,
    endpointSnapshot: null,
    status: "pending" as const,
    supersededBy: null,
    attemptCount: 1,
    artifactHash: checkpointArtifactHash(payload),
    executeResult: null,
    createdAt: now,
    resolvedAt: null,
    resolvedByUserId: null,
    refreshRequestedAt: null,
    ...overrides,
  };
}

type Write = { table: string; values: Record<string, unknown> };
const writes: Write[] = [];

function tableName(table: unknown): string {
  if (table === checkpoints) return "checkpoints";
  if (table === companyRecords) return "companyRecords";
  if (table === chats) return "chats";
  return "other";
}

/**
 * `claims` decides what each guarded checkpoint claim returns, in call order:
 * true = the guard matched a row, false = another request got there first.
 */
function mockUpdates(claims: boolean[] = [], failTable?: string) {
  writes.length = 0;
  const queue = [...claims];
  vi.mocked(db.update).mockImplementation(
    (table: unknown) =>
      ({
        set: (values: Record<string, unknown>) => {
          writes.push({ table: tableName(table), values });
          const returning = vi.fn(async () => {
            const won = queue.length ? queue.shift() : true;
            return won ? [{ id: checkpointId }] : [];
          });
          const where = vi.fn(() => {
            const result = (
              failTable === tableName(table)
                ? Promise.reject(new Error(`${failTable} write failed`))
                : Promise.resolve(undefined)
            ) as Promise<undefined> & {
              returning: typeof returning;
            };
            result.returning = returning;
            return result;
          });
          return { where };
        },
      }) as never,
  );
  // Record status writes go through the lead event log; record them as the
  // same company_records write so the assertions below read one list.
  transitionLeadStatus.mockImplementation(
    async (
      _db: unknown,
      input: { toStatus: string; set?: Record<string, unknown> },
    ) => {
      writes.push({
        table: "companyRecords",
        values: { ...input.set, status: input.toStatus },
      });
      if (failTable === "companyRecords") {
        throw new Error("companyRecords write failed");
      }
      return { changed: true, event: { id: "ev" } };
    },
  );
}

const of = (table: string) =>
  writes.filter((w) => w.table === table).map((w) => w.values);

describe("resolveCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdates();
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(row() as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
  });

  it("returns 404 when the checkpoint is missing", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(undefined);
    await expect(
      resolveCheckpoint({ checkpointId, action: "approve", userId, now }),
    ).resolves.toEqual({ ok: false, httpStatus: 404 });
  });

  it("approves on the copy path and advances the record", async () => {
    const result = await resolveCheckpoint({
      checkpointId,
      action: "approve",
      userId,
      now,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "approved",
      executeResult: {
        mode: "copy",
        channel: "email",
        recipient: "ada@acme.com",
        subject: "Hello Acme",
        body: "Tailored note",
      },
    });
    expect(of("checkpoints")[0]).toMatchObject({
      status: "approved",
      resolvedByUserId: userId,
      attemptCount: 1,
    });
    expect(of("checkpoints")[1]).toMatchObject({
      executeResult: expect.objectContaining({ mode: "copy" }),
    });
    expect(of("companyRecords")).toEqual([
      expect.objectContaining({
        status: "outreach_approved",
        nextFollowUpAt: new Date("2026-09-03T12:00:00.000Z"),
      }),
    ]);
    expect(of("chats")).toEqual([{ status: "completed", lastActivityAt: now }]);
  });

  it("leaves a customer chat's status alone when syncSession is false (W3GAP2)", async () => {
    const result = await resolveCheckpoint({
      checkpointId,
      action: "approve",
      userId,
      now,
      syncSession: false,
    });

    expect(result).toMatchObject({ ok: true, status: "approved" });
    expect(of("checkpoints")[0]).toMatchObject({ status: "approved" });
    expect(of("chats")).toEqual([]);
  });

  it("marks stale instead of approving when the draft changed", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ payload: { ...payload, body: "Edited by a member" } }) as never,
    );
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: checkpointId },
    ] as never);

    const result = await resolveCheckpoint({
      checkpointId,
      action: "approve",
      userId,
      now,
    });

    expect(result).toMatchObject({ ok: true, status: "stale" });
    expect(of("checkpoints")).toEqual([
      expect.objectContaining({ status: "stale" }),
    ]);
    expect(of("companyRecords")).toEqual([]);
    expect(of("chats")).toEqual([{ status: "needs_you", lastActivityAt: now }]);
  });

  it("blocks approve on a stale card until Refresh", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ status: "stale" }) as never,
    );
    await expect(
      resolveCheckpoint({ checkpointId, action: "approve", userId, now }),
    ).resolves.toEqual({ ok: false, httpStatus: 409, status: "stale" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refresh leaves the stale card for the agent's new card to supersede", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ status: "stale" }) as never,
    );
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: checkpointId },
    ] as never);
    const result = await resolveCheckpoint({
      checkpointId,
      action: "refresh",
      userId,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "stale",
      executeResult: { status: "refresh_requested" },
      alreadyRequested: false,
    });
    expect(of("checkpoints")).toEqual([{ refreshRequestedAt: now }]);
    expect(of("chats")).toEqual([{ status: "needs_you", lastActivityAt: now }]);
  });

  it("a second refresh while the first is unanswered is a no-op", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ status: "stale", refreshRequestedAt: now }) as never,
    );
    // The guarded stamp matches no row: a refresh is already outstanding.
    mockUpdates([false]);
    const result = await resolveCheckpoint({
      checkpointId,
      action: "refresh",
      userId,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "stale",
      alreadyRequested: true,
    });
    expect(of("chats")).toEqual([]);
  });

  it("retries an approved card stuck without an execute result", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({
        status: "approved",
        executeResult: null,
        resolvedAt: new Date(now.getTime() - 6 * 60 * 1000),
      }) as never,
    );
    const result = await resolveCheckpoint({
      checkpointId,
      action: "retry",
      userId,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "approved",
      executeResult: expect.objectContaining({ mode: "copy" }),
    });
    expect(of("checkpoints")[0]).toMatchObject({
      status: "approved",
      attemptCount: 2,
    });
  });

  it("refuses Retry on an approved card claimed under 5 minutes ago", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({
        status: "approved",
        executeResult: null,
        resolvedAt: new Date(now.getTime() - 60 * 1000),
      }) as never,
    );
    await expect(
      resolveCheckpoint({ checkpointId, action: "retry", userId, now }),
    ).resolves.toEqual({ ok: false, httpStatus: 409, status: "approved" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("keeps the card approved when the record write fails after execution", async () => {
    mockUpdates([], "companyRecords");
    const result = await resolveCheckpoint({
      checkpointId,
      action: "approve",
      userId,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "approved",
      executeResult: {
        mode: "copy",
        persistError: "companyRecords write failed",
      },
    });
    const cardWrites = of("checkpoints");
    expect(cardWrites.some((v) => v.status === "failed")).toBe(false);
    expect(cardWrites.at(-1)).toMatchObject({
      executeResult: expect.objectContaining({
        mode: "copy",
        persistError: "companyRecords write failed",
      }),
    });
  });

  it("discards and sets the record back to researched", async () => {
    const result = await resolveCheckpoint({
      checkpointId,
      action: "discard",
      userId,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "discarded",
      executeResult: { status: "discarded" },
    });
    expect(of("companyRecords")).toEqual([
      expect.objectContaining({ status: "researched" }),
    ]);
  });

  it("discards a checkpoint with no company record without touching records", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ recordId: null }) as never,
    );
    const result = await resolveCheckpoint({
      checkpointId,
      action: "discard",
      userId,
      now,
    });
    expect(result).toMatchObject({ ok: true, status: "discarded" });
    expect(of("companyRecords")).toEqual([]);
  });

  it("requires feedback to ask for changes", async () => {
    await expect(
      resolveCheckpoint({
        checkpointId,
        action: "ask_for_changes",
        userId,
        feedback: "  ",
        now,
      }),
    ).resolves.toEqual({ ok: false, httpStatus: 400 });
  });

  it("asks for changes and puts the session back to running", async () => {
    const result = await resolveCheckpoint({
      checkpointId,
      action: "ask_for_changes",
      userId,
      feedback: "Shorter, mention the pilot",
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "changes_requested",
      executeResult: {
        status: "changes_requested",
        feedback: "Shorter, mention the pilot",
      },
    });
    expect(of("companyRecords")).toEqual([]);
    expect(of("chats")).toEqual([{ status: "running", lastActivityAt: now }]);
  });

  it("lands in failed when no connector can execute the kind", async () => {
    const post = {
      kind: "post" as const,
      channel: "instagram" as const,
      body: "Hi",
      mediaUrls: [],
      scheduledFor: null,
      reason: "Weekly",
    };
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({
        kind: "post",
        recordId: null,
        payload: post,
        artifactHash: checkpointArtifactHash(post),
      }) as never,
    );
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { id: checkpointId },
    ] as never);

    const result = await resolveCheckpoint({
      checkpointId,
      action: "approve",
      userId,
      now,
    });

    expect(result).toMatchObject({ ok: true, status: "failed" });
    expect(of("checkpoints")[1]).toMatchObject({
      status: "failed",
      executeResult: expect.objectContaining({
        error: expect.stringContaining("post"),
      }),
    });
    expect(of("chats")).toEqual([{ status: "needs_you", lastActivityAt: now }]);
  });

  it("retries a failed card on the same row with attempt count +1", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ status: "failed", attemptCount: 2 }) as never,
    );
    const result = await resolveCheckpoint({
      checkpointId,
      action: "retry",
      userId,
      now,
    });
    expect(result).toMatchObject({ ok: true, status: "approved" });
    expect(of("checkpoints")[0]).toMatchObject({
      status: "approved",
      attemptCount: 3,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects actions on a superseded card", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({ status: "changes_requested", supersededBy: "newer" }) as never,
    );
    await expect(
      resolveCheckpoint({ checkpointId, action: "discard", userId, now }),
    ).resolves.toEqual({
      ok: false,
      httpStatus: 409,
      status: "changes_requested",
    });
  });

  it("lets only the request that won the guard advance the record", async () => {
    // Both requests read the card as pending; the second guard matches 0 rows.
    mockUpdates([true, false]);

    const [first, second] = await Promise.all([
      resolveCheckpoint({ checkpointId, action: "approve", userId, now }),
      resolveCheckpoint({
        checkpointId,
        action: "approve",
        userId: "user-2",
        now,
      }),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, httpStatus: 409, status: "pending" },
    ]);
    expect(of("companyRecords")).toHaveLength(1);
    expect(
      of("checkpoints").filter((v) => "executeResult" in v && v.executeResult && "mode" in (v.executeResult as object)),
    ).toHaveLength(1);
  });

  it("credits the person who resolved the card in the lead event log", async () => {
    await resolveCheckpoint({ checkpointId, action: "approve", userId, now });
    expect(transitionLeadStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "550e8400-e29b-41d4-a716-446655440000",
        recordId,
        toStatus: "outreach_approved",
        actor: { userId },
      }),
    );
    expect(markLeadDelivered).not.toHaveBeenCalled();
  });

  it("sends a lead delivery through the worker and marks the lead delivered", async () => {
    const delivery = {
      kind: "lead_delivery" as const,
      leadId: "lead-1",
      channel: "whatsapp" as const,
      recipient: "+905551112233",
      summary: "Ayse, villa",
      reason: "fit 82",
    };
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({
        kind: "lead_delivery",
        recordId: null,
        payload: delivery,
        artifactHash: checkpointArtifactHash(delivery),
      }) as never,
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mode: "sent", messageId: "wamid-1" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveCheckpoint({
        checkpointId,
        action: "approve",
        userId,
        now,
      });
      expect(result).toMatchObject({
        ok: true,
        status: "approved",
        executeResult: { mode: "sent", messageId: "wamid-1" },
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://worker:3001/internal/lead-delivery",
      );
      expect(markLeadDelivered).toHaveBeenCalledWith({
        companyId: "550e8400-e29b-41d4-a716-446655440000",
        leadId: "lead-1",
        userId,
        at: now,
      });
      expect(of("companyRecords")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails a lead delivery the worker could not send, without marking it delivered", async () => {
    const delivery = {
      kind: "lead_delivery" as const,
      leadId: "lead-1",
      channel: "whatsapp" as const,
      recipient: "+905551112233",
      summary: "Ayse, villa",
      reason: "fit 82",
    };
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      row({
        kind: "lead_delivery",
        recordId: null,
        payload: delivery,
        artifactHash: checkpointArtifactHash(delivery),
      }) as never,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "WhatsApp send failed" }), { status: 502 }),
      ),
    );
    try {
      const result = await resolveCheckpoint({
        checkpointId,
        action: "approve",
        userId,
        now,
      });
      expect(result).toMatchObject({
        ok: true,
        status: "failed",
        executeResult: { error: "WhatsApp send failed" },
      });
      expect(markLeadDelivered).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("lead delivery bookkeeping (W3GAP)", () => {
    const delivery = {
      kind: "lead_delivery" as const,
      leadId: "lead-1",
      channel: "whatsapp" as const,
      recipient: "+905551112233",
      summary: "Ayse, villa",
      reason: "fit 82",
    };
    const sent = { mode: "sent", messageId: "wamid-1" };
    const deliveryRow = (overrides: Record<string, unknown> = {}) =>
      row({
        kind: "lead_delivery",
        recordId: null,
        payload: delivery,
        artifactHash: checkpointArtifactHash(delivery),
        ...overrides,
      });

    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(sent)));
      vi.stubGlobal("fetch", fetchMock);
      markLeadDelivered.mockResolvedValue({ delivered: true });
    });
    afterEach(() => vi.unstubAllGlobals());

    // Item 6: the send went out but markLeadDelivered threw. Retry re-runs the
    // bookkeeping; the worker's send marker returns the first result.
    it("lets Retry redo the bookkeeping after a good send", async () => {
      vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
        deliveryRow({
          status: "approved",
          resolvedAt: now,
          executeResult: { ...sent, persistError: "db down" },
        }) as never,
      );
      const result = await resolveCheckpoint({ checkpointId, action: "retry", userId, now });
      expect(result).toMatchObject({ ok: true, status: "approved", executeResult: sent });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(markLeadDelivered).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: "lead-1", userId }),
      );
      expect(of("checkpoints")[0]).toMatchObject({ status: "approved", attemptCount: 2 });
    });

    it("keeps Retry closed on an outreach card with a bookkeeping error", async () => {
      vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
        row({
          status: "approved",
          resolvedAt: now,
          executeResult: { mode: "copy", persistError: "db down" },
        }) as never,
      );
      await expect(
        resolveCheckpoint({ checkpointId, action: "retry", userId, now }),
      ).resolves.toMatchObject({ ok: false, httpStatus: 409 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("marks a persist failure so it can be retried", async () => {
      vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(deliveryRow() as never);
      markLeadDelivered.mockRejectedValue(new Error("db down"));
      const result = await resolveCheckpoint({ checkpointId, action: "approve", userId, now });
      expect(result).toMatchObject({
        ok: true,
        status: "approved",
        executeResult: { ...sent, persistError: "db down" },
      });
    });

    // Item 7: a lead that is no longer qualified fails the card with a reason.
    it("fails the card when the lead is not deliverable", async () => {
      vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(deliveryRow() as never);
      markLeadDelivered.mockResolvedValue({ delivered: false, reason: "not_deliverable" });
      const result = await resolveCheckpoint({ checkpointId, action: "approve", userId, now });
      expect(result).toMatchObject({
        ok: true,
        status: "failed",
        executeResult: { error: expect.stringContaining("not qualified") },
      });
      expect(of("checkpoints").at(-1)).toMatchObject({ status: "failed" });
    });
  });

  it("a losing discard does not reset the record an approve just advanced", async () => {
    mockUpdates([true, false]);
    const [approve, discard] = await Promise.all([
      resolveCheckpoint({ checkpointId, action: "approve", userId, now }),
      resolveCheckpoint({ checkpointId, action: "discard", userId, now }),
    ]);
    expect(approve).toMatchObject({ ok: true, status: "approved" });
    expect(discard).toMatchObject({ ok: false, httpStatus: 409 });
    expect(of("companyRecords")).toEqual([
      expect.objectContaining({ status: "outreach_approved" }),
    ]);
  });
});
