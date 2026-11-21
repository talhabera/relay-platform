import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  campaignMetrics,
  campaignOf,
  getCampaignMetrics,
  type CampaignLeadFact,
} from "./campaigns";

function lead(id: string, over: Partial<CampaignLeadFact> = {}): CampaignLeadFact {
  return { id, source: "whatsapp", referral: null, payload: {}, ...over };
}

const KITCHEN = { sourceId: "120212345", headline: "Mutfak yenileme", sourceType: "ad" };

describe("campaignOf", () => {
  it("credits a Click-to-WhatsApp referral by ad id, named by headline", () => {
    expect(campaignOf(lead("a", { referral: KITCHEN }))).toEqual({
      id: "ad:120212345",
      kind: "ad",
      name: "Mutfak yenileme",
    });
  });

  it("names an ad without a headline by its id, and falls back to the source URL", () => {
    expect(campaignOf(lead("a", { referral: { sourceId: "99" } }))?.name).toBe("Ad 99");
    expect(campaignOf(lead("a", { referral: { sourceUrl: "https://fb.me/x" } }))).toEqual({
      id: "url:https://fb.me/x",
      kind: "ad",
      name: "https://fb.me/x",
    });
  });

  it("uses the intake kod when there is no referral; the referral wins over kod", () => {
    expect(campaignOf(lead("a", { payload: { intake: { kod: " BANYO24 " } } }))).toEqual({
      id: "kod:banyo24",
      kind: "kod",
      name: "Code BANYO24",
    });
    expect(
      campaignOf(lead("a", { referral: KITCHEN, payload: { intake: { kod: "BANYO24" } } }))?.id,
    ).toBe("ad:120212345");
  });

  it("returns null without attribution (empty referral, blank kod, malformed intake)", () => {
    expect(campaignOf(lead("a"))).toBeNull();
    expect(campaignOf(lead("a", { referral: { ctwaClid: "x" } }))).toBeNull();
    expect(campaignOf(lead("a", { payload: { intake: { kod: "  " } } }))).toBeNull();
    expect(campaignOf(lead("a", { payload: { intake: ["kod"] } }))).toBeNull();
  });
});

describe("campaignMetrics", () => {
  it("counts leads and qualified leads per campaign, most leads first, ties by name", () => {
    const leads = [
      lead("k1", { referral: KITCHEN }),
      lead("k2", { referral: KITCHEN }),
      lead("k3", { referral: { ...KITCHEN, headline: "Renamed" } }),
      lead("b1", { source: "instagram", payload: { intake: { kod: "banyo24" } } }),
      lead("b2", { source: "widget", payload: { intake: { kod: "BANYO24" } } }),
      lead("b3", { source: "widget", payload: { intake: { kod: "Banyo24" } } }),
      lead("z1", { payload: { intake: { kod: "Z" } } }),
      lead("none"),
    ];
    const metrics = campaignMetrics(leads, new Set(["k1", "k3", "b2", "none"]));
    expect(metrics).toEqual([
      { id: "kod:banyo24", kind: "kod", name: "Code banyo24", source: "widget", leads: 3, qualified: 1 },
      { id: "ad:120212345", kind: "ad", name: "Mutfak yenileme", source: "whatsapp", leads: 3, qualified: 2 },
      { id: "kod:z", kind: "kod", name: "Code Z", source: "whatsapp", leads: 1, qualified: 0 },
    ]);
  });

  it("is empty without attributed leads", () => {
    expect(campaignMetrics([lead("a")], new Set(["a"]))).toEqual([]);
  });
});

describe("getCampaignMetrics", () => {
  const leadEventsFindMany = vi.fn();
  const range = { from: new Date("2026-10-04T21:00:00Z"), to: new Date("2026-10-11T21:00:00Z") };

  beforeEach(() => {
    vi.clearAllMocks();
    (db.query as unknown as Record<string, unknown>).leadEvents = { findMany: leadEventsFindMany };
  });

  it("loads the week's attributed leads and their qualified events", async () => {
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([
      { id: "k1", source: "whatsapp", referral: KITCHEN, payload: {} },
      { id: "k2", source: "whatsapp", referral: KITCHEN, payload: {} },
      { id: "n1", source: "whatsapp", referral: null, payload: { intake: {} } },
    ] as never);
    leadEventsFindMany.mockResolvedValue([{ recordId: "k2" }]);

    const metrics = await getCampaignMetrics("co-1", range);

    expect(metrics).toEqual([
      { id: "ad:120212345", kind: "ad", name: "Mutfak yenileme", source: "whatsapp", leads: 2, qualified: 1 },
    ]);
    expect(leadEventsFindMany).toHaveBeenCalledTimes(1);
  });

  it("skips the event query when no lead carries a campaign", async () => {
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([] as never);
    expect(await getCampaignMetrics("co-1", range)).toEqual([]);
    expect(leadEventsFindMany).not.toHaveBeenCalled();
  });
});
