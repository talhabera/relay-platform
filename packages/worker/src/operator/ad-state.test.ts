import { describe, expect, it } from "vitest";
import { emptyLeadsByChannelDay } from "./ad-leads";
import { loadAdState, type AdSpendRow, type AdStateDeps } from "./ad-state";

const COMPANY = "company-a";
// 06:00 Istanbul on 2026-11-20.
const NOW = new Date("2026-11-20T03:00:00Z");

function spend(from: number, to: number, amountMinor: number): AdSpendRow[] {
  const rows: AdSpendRow[] = [];
  for (let d = from; d <= to; d++) {
    rows.push({ spendDate: `2026-11-${String(d).padStart(2, "0")}`, channel: "google", amountMinor, complete: true });
  }
  return rows;
}

function deps() {
  const calls: Array<[string, string]> = [];
  const leads = emptyLeadsByChannelDay();
  leads.google = { "2026-11-10": 3 };
  // `organik` leads attribute to unknown in ad-leads; many of them must not lower Google's CPL.
  leads.unknown = { "2026-11-10": 50, "2026-11-19": 2 };
  const d: AdStateDeps = {
    loadCompany: async (companyId) => {
      calls.push(["company", companyId]);
      return {
        timezone: "Europe/Istanbul",
        cplStopMinor: 80_000,
        monthlyTargetMinor: 3_000_000,
        dailyCapMinor: null,
        capacitySiteMonthly: 2,
        capacitySocialMonthly: null,
      };
    },
    loadSpendRows: async (companyId) => {
      calls.push(["spend", companyId]);
      return spend(1, 19, 20_000);
    },
    loadLeadsByChannelDay: async (companyId) => {
      calls.push(["leads", companyId]);
      return leads;
    },
    loadWonByPackageThisMonth: async (companyId, _monthStart, _tz, limits) => {
      calls.push(["won", companyId]);
      return {
        site: { won: 2, limit: limits.site, full: limits.site !== null && 2 >= limits.site },
        social: { won: 0, limit: limits.social, full: false },
      };
    },
  };
  return { deps: d, calls };
}

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("loadAdState", () => {
  it("passes only the run's company to every loader", async () => {
    const { deps: d, calls } = deps();
    await loadAdState(COMPANY, NOW, d);
    expect(calls.map(([name]) => name).sort()).toEqual(["company", "leads", "spend", "won"]);
    expect(calls.every(([, id]) => id === COMPANY)).toBe(true);
  });

  it("carries no config, token or secret keys", async () => {
    const state = await loadAdState(COMPANY, NOW, deps().deps);
    const keys = keysDeep(state).map((k) => k.toLowerCase());
    for (const banned of ["config", "token", "secret"]) {
      expect(keys.some((k) => k.includes(banned)), banned).toBe(false);
    }
  });

  it("reports organik leads as bilinmiyor and keeps them out of a channel's CPL", async () => {
    const state = await loadAdState(COMPANY, NOW, deps().deps);
    const unknown = state.table.find((r) => r.channel === "unknown")!;
    expect(unknown.label).toBe("bilinmiyor");
    expect(unknown.yesterday).toMatchObject({ leads: 2, spend: null });
    expect(unknown.month.leads).toBe(52);
    // Window Nov 1..17 (mature through today-3): 17 days x 20_000 / 3 Google leads.
    const google = state.channels.find((c) => c.channel === "google")!;
    expect(google.window).toMatchObject({ spendMinor: 340_000, leads: 3, cplMinor: 113_333 });
    expect(state.proposals.map((p) => p.key)).toEqual(["pause_channel:google"]);
    expect(state.proposals[0]).toMatchObject({
      cpl: { minor: 113_333, text: "1.133 TL" },
      threshold: { minor: 80_000, text: "800 TL" },
      lowData: true,
    });
  });

  it("formats money for the model and fills capacity and hrefs", async () => {
    const state = await loadAdState(COMPANY, NOW, deps().deps);
    const google = state.table.find((r) => r.channel === "google")!;
    expect(google.yesterday.spend).toMatchObject({ minor: 20_000, text: "200 TL", complete: true });
    expect(google.month.spend).toMatchObject({ minor: 380_000, text: "3.800 TL", missingDays: 0 });
    expect(state.table.find((r) => r.channel === "meta")!.yesterday.spend).toMatchObject({
      minor: null,
      text: "girilmedi",
    });
    expect(state.capacity.site).toEqual({ won: 2, limit: 2, full: true });
    expect(state.settings.dailyCap).toBeNull();
    expect(state.hrefs.spendEntry.startsWith("/")).toBe(true);
  });

  it("is identical on two calls with the same now", async () => {
    const a = await loadAdState(COMPANY, NOW, deps().deps);
    const b = await loadAdState(COMPANY, NOW, deps().deps);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
