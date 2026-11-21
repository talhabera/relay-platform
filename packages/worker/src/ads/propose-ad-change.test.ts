import { describe, expect, it, vi } from "vitest";
import {
  AD_CHANGE_CARD_TTL_MS,
  budgetDelta,
  type AdChangeCommand,
  type AdChangeReason,
} from "@relay/db";
import type { AdChangePayload } from "@relay/db/schema/checkpoints";
import type { AdCampaignState, AdPlatformAdapter } from "../integrations/ads/adapter";
import type { ApplyAdChangeInput, ApplyAdChangeResult } from "./apply-ad-change";
import {
  proposeAdChange,
  proposeAdChangeInputSchema,
  type AutonomyFacts,
  type ProposeAdChangeDeps,
} from "./propose-ad-change";

const CO = "co-1";
const AGENT = "agent-1";
const NOW = new Date("2026-11-06T09:00:00Z");
const PARENT = { cronRunId: "run-1" };
const CAP = 100_000;

const CAMPAIGNS: AdCampaignState[] = [
  { campaignId: "c1", name: "Arama 1", status: "enabled", dailyBudgetMinor: 30_000, currency: "TRY" },
  { campaignId: "c2", name: "Arama 2", status: "enabled", dailyBudgetMinor: 40_000, currency: "TRY" },
  { campaignId: "c3", name: "Arama 3", status: "paused", dailyBudgetMinor: 25_000, currency: "TRY" },
];

const REASON: AdChangeReason = { text: "CPL esigi asti", metric: "cpl", value: 90_000, threshold: 60_000 };

const GOOD: AutonomyFacts = {
  autonomousReductionsToday: 0,
  liveChannelCount: 2,
  channelLeadCount: 6,
  dataMature: true,
};

const target = { platform: "google" as const, accountId: "acc-1" };

function setup(opts: { facts?: Partial<AutonomyFacts>; mode?: "fake" | "manual" } = {}) {
  const cards: { companyId: string; agentId: string; parent: unknown; payload: AdChangePayload }[] = [];
  const applyChange = vi.fn();
  const adapter = {
    platform: "google",
    mode: opts.mode ?? "fake",
    listCampaigns: vi.fn(async () => ({ ok: true as const, value: CAMPAIGNS })),
    getDailySpend: vi.fn(),
    getPerformance: vi.fn(),
    getSearchTerms: vi.fn(),
    applyChange,
  } as unknown as AdPlatformAdapter;
  const applyAdChange = vi.fn(async (input: ApplyAdChangeInput): Promise<ApplyAdChangeResult> => {
    if (input.mode === "reject_only") {
      return { outcome: "rejected", changeId: "rej-1", totalAfterMinor: 100_100, code: "cap_exceeded" };
    }
    const c = CAMPAIGNS.find((x) => x.campaignId === input.command.campaignId)!;
    const before = { status: c.status, dailyBudgetMinor: c.dailyBudgetMinor };
    return {
      outcome: "applied",
      changeId: "chg-1",
      totalAfterMinor: 40_000,
      beforeValue: before,
      afterValue:
        input.command.action === "pause"
          ? { ...before, status: "paused" }
          : { ...before, dailyBudgetMinor: (input.command as { afterMinor: number }).afterMinor },
    };
  });
  const deps: ProposeAdChangeDeps = {
    store: {
      capInputs: vi.fn(async () => ({ capMinor: CAP, reservedMinor: 0 })),
      autonomyFacts: vi.fn(async () => ({ ...GOOD, ...opts.facts })),
      insertCard: vi.fn(async (card) => {
        cards.push(card);
        return `card-${cards.length}`;
      }),
    },
    adapterFor: () => adapter,
    applyAdChange,
    now: () => NOW,
  };
  const run = (command: AdChangeCommand, reason: unknown = REASON) =>
    proposeAdChange({ companyId: CO, agentId: AGENT, parent: PARENT, command, reason }, deps);
  return { run, cards, applyAdChange, applyChange, deps };
}

const pause = (campaignId = "c1", extra: Partial<AdChangeCommand> = {}): AdChangeCommand =>
  ({ ...target, campaignId, action: "pause", ...extra }) as AdChangeCommand;

describe("proposeAdChange: autonomous reductions", () => {
  it("pauses one of two live channels with 6 leads on its own and raises an undo card", async () => {
    const t = setup();
    const out = await t.run(pause());
    expect(t.applyAdChange).toHaveBeenCalledTimes(1);
    expect(t.applyAdChange.mock.calls[0][0]).toMatchObject({
      companyId: CO,
      mode: "apply",
      autonomous: true,
      actor: { type: "agent", agentId: AGENT },
      command: pause(),
    });
    expect(out).toMatchObject({ status: "applied", changeId: "chg-1", undoPendingId: "card-1" });
    expect(t.cards).toHaveLength(1);
    const undo = t.cards[0].payload;
    expect(undo).toMatchObject({
      kind: "ad_change",
      mode: "undo",
      reversesChangeId: "chg-1",
      command: { ...target, campaignId: "c1", action: "resume" },
      executionMode: "api",
      deltaMinor: 30_000,
      expiresAt: new Date(NOW.getTime() + AD_CHANGE_CARD_TTL_MS).toISOString(),
    });
    expect(t.cards[0].parent).toEqual(PARENT);
  });

  it("reports applied with no undo card when the undo card insert throws, so the agent does not retry", async () => {
    const t = setup();
    vi.mocked(t.deps.store.insertCard).mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await t.run(pause());
    expect(t.applyAdChange).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "applied", changeId: "chg-1", undoPendingId: null });
    expect(out).not.toHaveProperty("error");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("builds the undo of a budget decrease from the applied result's beforeValue", async () => {
    const t = setup();
    const cmd = { ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 20_000 } as const;
    await t.run(cmd);
    expect(t.applyAdChange.mock.calls[0][0]).toMatchObject({ mode: "apply", autonomous: true });
    expect(t.cards[0].payload).toMatchObject({
      mode: "undo",
      command: { ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 30_000 },
      deltaMinor: 10_000,
    });
  });

  it.each([
    ["the second autonomous reduction of the day", { autonomousReductionsToday: 1 }],
    ["the last live channel", { liveChannelCount: 1 }],
    ["a channel with 4 leads", { channelLeadCount: 4 }],
    ["immature or veri yok data", { dataMature: false }],
  ])("turns a pause on %s into a change card", async (_label, facts) => {
    const t = setup({ facts });
    const out = await t.run(pause());
    expect(t.applyAdChange).not.toHaveBeenCalled();
    expect(t.cards).toHaveLength(1);
    expect(t.cards[0].payload).toMatchObject({ kind: "ad_change", mode: "change", executionMode: "api" });
    expect(out).toEqual({
      status: "pending_approval",
      pendingId: "card-1",
      kind: "ad_change",
      message: "Wait for Approve or Discard.",
    });
  });

  it.each([
    ["the second autonomous reduction of the day", { autonomousReductionsToday: 1 }],
    ["the last live channel", { liveChannelCount: 1 }],
    ["immature data", { dataMature: false }],
  ])("turns a budget decrease on %s into a change card", async (_label, facts) => {
    const t = setup({ facts });
    await t.run({ ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 20_000 });
    expect(t.applyAdChange).not.toHaveBeenCalled();
    expect(t.cards[0].payload).toMatchObject({ mode: "change", deltaMinor: -10_000 });
  });
});

describe("proposeAdChange: always a card", () => {
  const commands: [string, AdChangeCommand][] = [
    ["resume", { ...target, campaignId: "c3", action: "resume" }],
    ["budget increase", { ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 50_000 }],
    ["add keyword", { ...target, campaignId: "c1", action: "add_keyword", adGroupId: "g1", keyword: "kurs", matchType: "phrase" }],
    ["add negative keyword", { ...target, campaignId: "c1", action: "add_negative_keyword", keyword: "bedava", matchType: "exact" }],
    ["copy update", { ...target, campaignId: "c1", action: "update_ad_copy", adGroupId: "g1", headlines: ["Yeni"], descriptions: ["Aciklama"] }],
  ];

  it.each(commands)("%s becomes a change card and never writes to the platform", async (_label, command) => {
    const t = setup();
    const out = await t.run(command);
    expect(t.applyAdChange).not.toHaveBeenCalled();
    expect(t.applyChange).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "pending_approval", pendingId: "card-1" });
    const card = t.cards[0].payload;
    const campaign = CAMPAIGNS.find((c) => c.campaignId === command.campaignId)!;
    expect(card).toMatchObject({ kind: "ad_change", mode: "change", command, campaignName: campaign.name });
    expect(card.deltaMinor).toBe(budgetDelta(command, campaign));
    expect(card.dailyTotalAfterMinor).toBe(70_000 + card.deltaMinor);
    expect(card.expiresAt).toBe(new Date(NOW.getTime() + AD_CHANGE_CARD_TTL_MS).toISOString());
  });

  it("carries deltaMinor equal to budgetDelta on an increase card", async () => {
    const t = setup();
    await t.run({ ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 50_000 });
    expect(t.cards[0].payload.deltaMinor).toBe(20_000);
  });
});

describe("proposeAdChange: cap", () => {
  it("refuses a change over the cap with no card, no apply, and one reject_only call", async () => {
    const t = setup();
    const cmd = { ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 60_100 } as const;
    const out = await t.run(cmd);
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("cap");
    expect(t.cards).toHaveLength(0);
    expect(t.applyAdChange).toHaveBeenCalledTimes(1);
    expect(t.applyAdChange.mock.calls[0][0]).toMatchObject({
      mode: "reject_only",
      autonomous: false,
      actor: { type: "agent", agentId: AGENT },
      command: cmd,
    });
  });

  it("refuses every increase when no cap is set", async () => {
    const t = setup();
    vi.mocked(t.deps.store.capInputs).mockResolvedValueOnce({ capMinor: null, reservedMinor: 0 });
    const out = await t.run({ ...target, campaignId: "c3", action: "resume" });
    expect(out).toHaveProperty("error");
    expect(t.cards).toHaveLength(0);
    expect(t.applyAdChange.mock.calls.map((c) => c[0].mode)).toEqual(["reject_only"]);
  });

  it("does not call reject_only when the check passes", async () => {
    const t = setup();
    await t.run({ ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 60_000 });
    expect(t.applyAdChange).not.toHaveBeenCalled();
    expect(t.cards).toHaveLength(1);
  });
});

describe("proposeAdChange: input rules", () => {
  it.each(["metric", "value", "threshold"])("refuses a reason without %s", async (key) => {
    const t = setup();
    const reason = { ...REASON } as Record<string, unknown>;
    delete reason[key];
    const out = await t.run(pause(), reason);
    expect(out).toHaveProperty("error");
    expect(t.cards).toHaveLength(0);
    expect(t.applyAdChange).not.toHaveBeenCalled();
  });

  it("has no delete command", () => {
    // @ts-expect-error there is no delete action
    const del: AdChangeCommand = { ...target, campaignId: "c1", action: "delete" };
    expect(del).toBeDefined();
    const parsed = proposeAdChangeInputSchema.safeParse({
      command: { ...target, campaignId: "c1", action: "delete" },
      reason: REASON,
    });
    expect(parsed.success).toBe(false);
  });

  it("puts no token or secret field in a card payload", async () => {
    const t = setup();
    await t.run(pause());
    await t.run({ ...target, campaignId: "c1", action: "set_daily_budget", afterMinor: 50_000 });
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, inner] of Object.entries(v)) {
          keys.push(k);
          walk(inner);
        }
      }
    };
    t.cards.forEach((c) => walk(c.payload));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => /token|secret|password|credential|api_?key/i.test(k))).toEqual([]);
  });
});

describe("proposeAdChange: manual adapter", () => {
  const observed = { campaignName: "Arama 1", status: "enabled" as const, dailyBudgetMinor: 30_000 };

  it("turns even an autonomous-eligible pause into a manual change card", async () => {
    const t = setup({ mode: "manual" });
    const out = await t.run(pause("c1", { observed }));
    expect(out).toMatchObject({ status: "pending_approval", pendingId: "card-1" });
    expect(t.applyAdChange.mock.calls.filter((c) => c[0].mode === "apply")).toHaveLength(0);
    expect(t.cards).toHaveLength(1);
    expect(t.cards[0].payload).toMatchObject({ mode: "change", executionMode: "manual", deltaMinor: -30_000 });
  });

  it("refuses a manual command without observed", async () => {
    const t = setup({ mode: "manual" });
    const out = await t.run(pause());
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("observed");
    expect(t.cards).toHaveLength(0);
  });
});
