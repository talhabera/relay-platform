import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_PERMISSIONS, OWNER_PAGE_PERMISSIONS } from "@relay/db/schema";
import { createFixtureReaders, fitScoreBand } from "./loaders";
import { fixtureData, FIXTURE_IDS as ID } from "./data";
import { getFixtureReaders, isFixturesEnabled } from "./index";
import type { RelayReaders } from "./interfaces";

const readers: RelayReaders = createFixtureReaders(fixtureData);

describe("fixtures flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless RELAY_FIXTURES=true", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RELAY_FIXTURES", "");
    expect(isFixturesEnabled()).toBe(false);
    vi.stubEnv("RELAY_FIXTURES", "true");
    expect(isFixturesEnabled()).toBe(true);
  });

  it("is never on in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RELAY_FIXTURES", "true");
    expect(isFixturesEnabled()).toBe(false);
    expect(() => getFixtureReaders()).toThrow(/fixtures are disabled/i);
  });

  it("returns readers when on", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RELAY_FIXTURES", "true");
    expect(getFixtureReaders().workflows).toBeDefined();
  });
});

describe("workflows", () => {
  it("returns stages, sequence edges, inbound and target progress", async () => {
    const [lead, social] = await readers.workflows.listWorkflows(ID.company);
    expect(lead.name).toBe("Lead engine");
    expect(lead.stages.map((s) => s.name)).toEqual([
      "Gather",
      "Qualify",
      "Outreach",
      "Delivered to client",
    ]);
    expect(lead.edges).toHaveLength(3);
    expect(lead.stages[3].agent).toBeNull();
    expect(lead.inbound?.stageId).toBe(lead.stages[1].id);
    expect(lead.target).toEqual({
      weeklyTarget: 10,
      metricKey: "leads.qualified_delivered",
      value: expect.any(Number),
    });
    expect(social.flow).toBe("parallel");
    expect(social.edges).toEqual([]);
  });

  it("derives stage pending and needs_you state from Needs you items", async () => {
    const [lead] = await readers.workflows.listWorkflows(ID.company);
    const qualify = lead.stages[1];
    expect(qualify.pending).toBeGreaterThan(0);
    expect(qualify.state).toBe("needs_you");
  });

  it("is empty for an unknown company", async () => {
    expect(await readers.workflows.listWorkflows("nope")).toEqual([]);
  });
});

describe("needs you", () => {
  it("orders by tier then oldest first, for the owner", async () => {
    const list = await readers.needsYou.getNeedsYou(ID.company, ID.owner);
    expect(list.total).toBe(list.items.length);
    const tiers = list.items.map((i) => i.tier);
    expect(tiers).toEqual([...tiers].sort());
    expect(list.items[0].type).toBe("failed_run");
  });

  it("hides checkpoints from a member without approve rights", async () => {
    const owner = await readers.needsYou.getNeedsYou(ID.company, ID.owner);
    const member = await readers.needsYou.getNeedsYou(ID.company, ID.viewer);
    expect(owner.items.some((i) => i.type === "checkpoint")).toBe(true);
    expect(member.items.some((i) => i.type === "checkpoint")).toBe(false);
  });
});

describe("access", () => {
  it("resolves owner, member, client and none", async () => {
    expect(await readers.access.getAccessRole(ID.company, ID.owner)).toBe("owner");
    expect(await readers.access.getAccessRole(ID.company, ID.viewer)).toBe("member");
    expect(await readers.access.getAccessRole(ID.company, ID.client)).toBe("client");
    expect(await readers.access.getAccessRole(ID.company, "stranger")).toBeNull();
  });

  it("lists approvers: owner, creator, and member agent users with approve", async () => {
    const approvers = await readers.access.listApprovers(ID.qualifier);
    const ids = approvers.map((a) => a.id);
    expect(ids).toContain(ID.owner);
    expect(ids).toContain(ID.approver);
    expect(ids).not.toContain(ID.viewer);
    expect(ids).not.toContain(ID.client);
  });
});

describe("leads", () => {
  it("bands fit scores at 70 and 50", () => {
    expect(fitScoreBand(70)).toBe("qualified");
    expect(fitScoreBand(69)).toBe("borderline");
    expect(fitScoreBand(50)).toBe("borderline");
    expect(fitScoreBand(49)).toBe("rejected");
    expect(fitScoreBand(null)).toBeNull();
  });

  it("filters by band and keeps band consistent with fit score", async () => {
    const all = await readers.leads.listLeads(ID.company);
    for (const l of all) expect(l.band).toBe(fitScoreBand(l.fitScore));
    const borderline = await readers.leads.listLeads(ID.company, {
      band: "borderline",
    });
    expect(borderline.length).toBeGreaterThan(0);
    expect(borderline.every((l) => l.band === "borderline")).toBe(true);
  });

  it("lead events have exactly one actor and respect the range", async () => {
    const from = new Date(0);
    const to = new Date("2100-01-01");
    const events = await readers.leads.listLeadEvents(ID.company, { from, to });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect((e.agentId === null) !== (e.userId === null)).toBe(true);
    }
    const none = await readers.leads.listLeadEvents(ID.company, { from, to: from });
    expect(none).toEqual([]);
  });
});

describe("handoff", () => {
  it("filters by status", async () => {
    const open = await readers.handoff.listHandoffRequests(ID.company, {
      status: ["open"],
    });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((r) => r.status === "open")).toBe(true);
  });
});

describe("reports and live feed", () => {
  it("lists closed snapshots per period, newest first", async () => {
    const weekly = await readers.reports.listReportSnapshots(ID.company, "weekly");
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.every((s) => s.period === "weekly")).toBe(true);
    const starts = weekly.map((s) => s.start.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    const one = await readers.reports.getReportSnapshot(ID.company, weekly[0].id);
    expect(one?.id).toBe(weekly[0].id);
    expect(await readers.reports.getReportSnapshot("nope", weekly[0].id)).toBeNull();
  });

  it("lists portal events newest first with since and limit", async () => {
    const all = await readers.portalEvents.listPortalEvents(ID.company);
    const ats = all.map((e) => e.at.getTime());
    expect(ats).toEqual([...ats].sort((a, b) => b - a));
    expect(await readers.portalEvents.listPortalEvents(ID.company, { limit: 1 })).toHaveLength(1);
    const since = await readers.portalEvents.listPortalEvents(ID.company, {
      since: all[0].at,
    });
    expect(since).toEqual([]);
  });
});

describe("home tiles", () => {
  it("owner sees every visible tile in order", async () => {
    const tiles = await readers.homeTiles.getVisibleHomeTiles(ID.company, {
      isOwner: true,
      pagePermissions: OWNER_PAGE_PERMISSIONS,
    });
    expect(tiles[0]).toBe("goal_strip");
    expect(tiles).toContain("needs_you");
  });

  it("member without operator access loses gated and owner-only tiles", async () => {
    const tiles = await readers.homeTiles.getVisibleHomeTiles(ID.company, {
      isOwner: false,
      pagePermissions: { ...DEFAULT_PAGE_PERMISSIONS, operator: false },
    });
    expect(tiles).not.toContain("needs_you");
    expect(tiles).not.toContain("goal_strip");
    expect(tiles).toContain("today");
  });
});
