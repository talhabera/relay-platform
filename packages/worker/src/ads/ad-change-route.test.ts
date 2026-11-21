import { describe, expect, it, vi } from "vitest";
import type { AdChangeCommand, AdChangeLogRow } from "@relay/db";
import type { AdChangePayload } from "@relay/db/schema/checkpoints";
import { createManualAdAdapter, type ManualAdStore } from "../integrations/ads/manual-adapter";
import {
  applyWith,
  handleAdChangeRequest,
  type AdChangeCard,
  type AdChangeCardStore,
  type AdChangeRouteDeps,
} from "./ad-change-route";
import { AdChangeInProgressError, type AdChangeStore, type ApplyAdChangeResult } from "./apply-ad-change";

const now = new Date("2026-11-06T12:00:00.000Z");

const command: AdChangeCommand = {
  platform: "google",
  accountId: "acc-1",
  campaignId: "cmp-1",
  action: "set_daily_budget",
  afterMinor: 60_000,
  observed: { campaignName: "Villa", status: "enabled", dailyBudgetMinor: 50_000 },
};

const payload: AdChangePayload = {
  kind: "ad_change",
  mode: "change",
  changeId: "chg-1",
  platform: "google",
  accountId: "acc-1",
  campaignId: "cmp-1",
  campaignName: "Villa",
  command,
  before: { dailyBudgetMinor: 50_000 },
  after: { dailyBudgetMinor: 60_000 },
  deltaMinor: 10_000,
  dailyTotalAfterMinor: 60_000,
  reason: { text: "CPL hedefin altında", metric: "cpl", value: 80, threshold: 100 },
  expiresAt: "2026-11-07T10:00:00.000Z",
  executionMode: "manual",
};

const baseCard: AdChangeCard = {
  id: "cp-1",
  companyId: "co-1",
  status: "approved",
  payload,
  attemptCount: 1,
  resolvedByUserId: "u-1",
};

function cardStore(card: AdChangeCard | null) {
  const saved: Record<string, unknown>[] = [];
  const cards: AdChangeCardStore = {
    load: async () => card,
    saveResult: async (_id, result) => {
      saved.push(result);
    },
  };
  return { cards, saved };
}

function deps(card: AdChangeCard | null, apply: AdChangeRouteDeps["apply"]) {
  const { cards, saved } = cardStore(card);
  return { deps: { cards, apply, now: () => now }, saved };
}

const applied: ApplyAdChangeResult = {
  outcome: "applied",
  changeId: "chg-9",
  totalAfterMinor: 60_000,
  beforeValue: { dailyBudgetMinor: 50_000 },
  afterValue: { dailyBudgetMinor: 60_000 },
};

describe("handleAdChangeRequest", () => {
  it("refuses a card that is not approved or not an ad change", async () => {
    const apply = vi.fn();
    const pending = deps({ ...baseCard, status: "pending" }, apply);
    expect(await handleAdChangeRequest("cp-1", pending.deps)).toMatchObject({ ok: false, status: 409 });
    const lead = deps(
      {
        ...baseCard,
        payload: { kind: "lead_delivery", leadId: "l", channel: "email", recipient: "a@b.c", summary: "s", reason: "r" },
      },
      apply,
    );
    expect(await handleAdChangeRequest("cp-1", lead.deps)).toMatchObject({ ok: false, status: 422 });
    expect(await handleAdChangeRequest("cp-1", deps(null, apply).deps)).toMatchObject({ ok: false, status: 404 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns 409 once expiresAt has passed", async () => {
    const apply = vi.fn();
    const { deps: d } = deps({ ...baseCard, payload: { ...payload, expiresAt: "2026-11-06T11:59:59.000Z" } }, apply);
    expect(await handleAdChangeRequest("cp-1", d)).toMatchObject({ ok: false, status: 409 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies as the approving person with the card's attempt count", async () => {
    const apply = vi.fn().mockResolvedValue(applied);
    const { deps: d, saved } = deps({ ...baseCard, attemptCount: 3 }, apply);
    const outcome = await handleAdChangeRequest("cp-1", d);
    expect(apply).toHaveBeenCalledWith({
      companyId: "co-1",
      command,
      reason: payload.reason,
      actor: { type: "human", userId: "u-1" },
      autonomous: false,
      checkpointId: "cp-1",
      attempt: 3,
      mode: "apply",
    });
    expect(outcome).toEqual({ ok: true, result: expect.objectContaining({ outcome: "applied", changeId: "chg-9" }) });
    expect(saved).toHaveLength(1);
  });

  it("maps rejected and failed to non-2xx; a manual cap refusal says to undo the panel change", async () => {
    const rejected = deps(baseCard, vi.fn().mockResolvedValue({ outcome: "rejected", code: "cap_exceeded", totalAfterMinor: 1 }));
    const r = await handleAdChangeRequest("cp-1", rejected.deps);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("geri al");
    const failed = deps(baseCard, vi.fn().mockResolvedValue({ outcome: "failed", code: "platform_error", detail: "boom", totalAfterMinor: null }));
    expect(await handleAdChangeRequest("cp-1", failed.deps)).toMatchObject({ ok: false, status: 502 });
    expect(rejected.saved).toEqual([]);
    expect(failed.saved).toEqual([]);
  });

  it("answers success with the applied outcome when saving the card result throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const apply = vi.fn().mockResolvedValue(applied);
      const cards: AdChangeCardStore = {
        load: async () => baseCard,
        saveResult: async () => {
          throw new Error("connection reset");
        },
      };
      const outcome = await handleAdChangeRequest("cp-1", { cards, apply, now: () => now });
      expect(outcome).toEqual({ ok: true, result: expect.objectContaining({ outcome: "applied", changeId: "chg-9" }) });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("saving the card result failed"), "cp-1", "connection reset");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a crashed attempt in progress answers 409 instead of applying again", async () => {
    const { deps: d } = deps(baseCard, vi.fn().mockRejectedValue(new AdChangeInProgressError("cp-1", 1)));
    expect(await handleAdChangeRequest("cp-1", d)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("approved manual card end to end", () => {
  function memLog() {
    const rows: AdChangeLogRow[] = [];
    let seq = 0;
    const store: AdChangeStore = {
      findByCheckpoint: async (id, attempt) => rows.filter((r) => r.checkpointId === id && r.attempt === attempt),
      insert: async (row) => {
        seq++;
        rows.push({ ...row, id: `row-${seq}`, seq } as unknown as AdChangeLogRow);
      },
      withCapLock: (_companyId, fn) =>
        fn({
          loadCapMinor: async () => 100_000,
          reservedMinor: async () => 0,
          findByCheckpoint: (id, attempt) => store.findByCheckpoint(id, attempt),
          insert: (row) => store.insert(row),
        }),
    };
    const manual: ManualAdStore = {
      appliedResults: async ({ companyId, platform, accountId }) =>
        rows
          .filter(
            (r) =>
              r.companyId === companyId &&
              r.platform === platform &&
              r.accountId === accountId &&
              r.phase === "result" &&
              r.outcome === "applied",
          )
          .reverse(),
    };
    return { rows, store, manual };
  }

  it("records an applied human result stamped manual, sets execute_result, and returns it again on a repeat", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no network in manual mode");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const log = memLog();
      const apply = applyWith({
        store: log.store,
        adapterFor: (platform, _companyId, opts) =>
          createManualAdAdapter({ platform, store: log.manual, command: opts.command }),
        now: () => now,
      });
      const { deps: d, saved } = deps(baseCard, apply);

      const first = await handleAdChangeRequest("cp-1", d);
      expect(first.ok).toBe(true);
      const results = log.rows.filter((r) => r.phase === "result");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        outcome: "applied",
        actorType: "human",
        actorUserId: "u-1",
        checkpointId: "cp-1",
        attempt: 1,
        outcomeDetail: "manual: applied by the owner in the ad panel",
        beforeValue: { status: "enabled", dailyBudgetMinor: 50_000 },
        afterValue: { status: "enabled", dailyBudgetMinor: 60_000, appliedBy: "manual" },
      });
      expect(saved[0]).toMatchObject({ outcome: "applied", executionMode: "manual" });

      const second = await handleAdChangeRequest("cp-1", d);
      expect(second).toEqual(first);
      expect(log.rows).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a Retry (attemptCount bumped by web) reaches applyAdChange with the bumped attempt after a crashed one", async () => {
    const log = memLog();
    // Attempt 1 crashed after its intent row and before its result row.
    log.rows.push({ id: "row-0", seq: 0, companyId: "co-1", checkpointId: "cp-1", attempt: 1, phase: "intent" } as unknown as AdChangeLogRow);
    const apply = vi.fn(
      applyWith({
        store: log.store,
        adapterFor: (platform, _companyId, opts) =>
          createManualAdAdapter({ platform, store: log.manual, command: opts.command }),
        now: () => now,
      }),
    );

    const crashed = deps(baseCard, apply);
    expect(await handleAdChangeRequest("cp-1", crashed.deps)).toMatchObject({ ok: false, status: 409 });

    const retried = deps({ ...baseCard, attemptCount: 2 }, apply);
    const outcome = await handleAdChangeRequest("cp-1", retried.deps);
    expect(outcome.ok).toBe(true);
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ checkpointId: "cp-1", attempt: 2 }));
    expect(log.rows.filter((r) => r.phase === "result")).toEqual([
      expect.objectContaining({ checkpointId: "cp-1", attempt: 2, outcome: "applied" }),
    ]);
  });
});
