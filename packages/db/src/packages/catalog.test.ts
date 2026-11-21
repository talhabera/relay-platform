import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG_TYPES } from "../connectors/types";
import { LEAD_ENGINE_INTAKE } from "../lead-intake";
import {
  BUILT_IN_CONNECTORS,
  getPackageDefinition,
  isPackageSlug,
  missingRequiredConnectors,
  PACKAGE_CARD_METRIC_KEYS,
  PACKAGE_CATALOG,
  PACKAGE_SLUGS,
  requiredConnectorTypes,
} from "./catalog";

describe("PACKAGE_CATALOG", () => {
  it("holds Lead engine, Social media, Insights, Daily manager, Ad monitor and Ad manager; revenue is gone", () => {
    expect(PACKAGE_CATALOG.map((p) => p.slug)).toEqual([
      "lead-engine",
      "social-media",
      "insights",
      "manager",
      "ad-monitor",
      "ad-manager",
    ]);
    expect(getPackageDefinition("revenue")).toBeNull();
    expect(isPackageSlug("revenue")).toBe(false);
    expect(getPackageDefinition("desk")).toBeNull();
  });

  it("splits Lead engine into three stage agents, one Schedule each", () => {
    const lead = getPackageDefinition("lead-engine")!;
    expect(lead.agents.map((a) => a.name)).toEqual([
      "Lead Gatherer",
      "Lead Qualifier",
      "Mail Marketer",
    ]);
    expect(lead.schedules.map((s) => s.agentKey)).toEqual([
      "gatherer",
      "qualifier",
      "mailer",
    ]);
    const [workflow] = lead.workflows;
    expect(workflow.stages.map((s) => s.name)).toEqual([
      "Gather",
      "Qualify",
      "Outreach",
      "Delivered to client",
    ]);
    expect(workflow.stages[workflow.inboundStageOrder!].name).toBe("Qualify");
    expect(workflow.intake).toEqual(LEAD_ENGINE_INTAKE);
    expect(workflow.weeklyTarget).toBe(10);
  });

  it("keeps the never-send rule: only the Mail Marketer may propose", () => {
    const lead = getPackageDefinition("lead-engine")!;
    const byKey = new Map(lead.agents.map((a) => [a.key, a]));
    expect(byKey.get("mailer")!.toolToggles.proposeAction).toBe(true);
    expect(byKey.get("mailer")!.instructions).toMatch(/never send/i);
    expect(byKey.get("gatherer")!.toolToggles.proposeAction).toBe(false);
    expect(byKey.get("qualifier")!.toolToggles.proposeAction).toBe(false);
    expect(lead.schedules[2].prompt).toContain("Never pass `force: true`");
  });

  it("lists connectors with requirements from the spec", () => {
    const lead = getPackageDefinition("lead-engine")!;
    expect(requiredConnectorTypes(lead)).toEqual([]);
    expect(
      lead.connectors.filter((c) => c.requirement === "optional").map((c) => c.type),
    ).toEqual(["google_places", "hunter", "snov", "google_workspace"]);

    const social = getPackageDefinition("social-media")!;
    expect(requiredConnectorTypes(social)).toEqual([
      "meta",
      "google_business_profile",
    ]);
    expect(missingRequiredConnectors(social, ["meta"])).toEqual([
      "google_business_profile",
    ]);
    expect(missingRequiredConnectors(social, ["meta", "google_business_profile"])).toEqual([]);

    const insights = getPackageDefinition("insights")!;
    expect(insights.connectors.every((c) => c.requirement === "built_in")).toBe(true);
    expect(insights.schedules).toHaveLength(1);
    expect(insights.schedules[0].scheduleKind).toBe("weekly");
  });

  it("is internally consistent", () => {
    for (const pkg of PACKAGE_CATALOG) {
      const keys = new Set(pkg.agents.map((a) => a.key));
      expect(keys.size, pkg.slug).toBe(pkg.agents.length);
      for (const s of pkg.schedules) expect(keys.has(s.agentKey), s.name).toBe(true);
      // One Schedule per agent at least (decision 1 / plan row: one per agent).
      for (const k of Array.from(keys)) {
        expect(pkg.schedules.some((s) => s.agentKey === k), k).toBe(true);
      }
      for (const w of pkg.workflows) {
        for (const st of w.stages) {
          if (st.agentKey !== null) expect(keys.has(st.agentKey), st.name).toBe(true);
        }
      }
      expect(PACKAGE_CARD_METRIC_KEYS).toContain(pkg.cardMetricKey);
      for (const c of pkg.connectors) {
        const known =
          c.requirement === "built_in"
            ? (BUILT_IN_CONNECTORS as readonly string[]).includes(c.type)
            : (CONNECTOR_CATALOG_TYPES as readonly string[]).includes(c.type);
        expect(known, c.type).toBe(true);
      }
    }
  });

  it("maps card metric keys per package", () => {
    expect(PACKAGE_CATALOG.map((p) => p.cardMetricKey)).toEqual([
      "workflow.weekly_target",
      "posts.month_review",
      "report.last_run",
      "brief.last_run",
      "brief.last_run",
      "brief.last_run",
    ]);
  });

  it("adds Ad manager: one operator agent, one daily 08:15 Schedule, built-in connectors only", () => {
    expect(PACKAGE_SLUGS).toContain("ad-manager");
    expect(isPackageSlug("ad-manager")).toBe(true);
    const ads = getPackageDefinition("ad-manager")!;
    expect(ads.agents).toHaveLength(1);
    expect(ads.agents[0].key).toBe("manager");
    expect(ads.schedules).toHaveLength(1);
    expect(ads.schedules[0]).toMatchObject({ agentKey: "manager", scheduleKind: "daily", timeOfDay: 495 });
    expect(ads.workflows).toEqual([]);
    expect(requiredConnectorTypes(ads)).toEqual([]);
    const text = ads.agents[0].instructions + ads.schedules[0].prompt;
    for (const tool of ["listAdCampaigns", "getAdPerformance", "getSearchTerms", "proposeAdChange", "readAdState"]) {
      expect(text).toContain(tool);
    }
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("keeps Ad monitor to one agent, one daily 08:00 Schedule, built-in connectors only", () => {
    const monitor = getPackageDefinition("ad-monitor")!;
    expect(monitor.agents.map((a) => a.key)).toEqual(["monitor"]);
    expect(monitor.agents[0].model).toBe("sonnet");
    expect(monitor.agents[0].toolToggles).toEqual({
      webSearch: false,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    });
    expect(monitor.workflows).toEqual([]);
    expect(monitor.schedules).toHaveLength(1);
    expect(monitor.schedules[0]).toMatchObject({ agentKey: "monitor", scheduleKind: "daily", timeOfDay: 480 });
    expect(monitor.connectors.every((c) => c.requirement === "built_in")).toBe(true);
    expect(monitor.cardMetricKey).toBe("brief.last_run");
    const text = monitor.agents[0].instructions + monitor.schedules[0].prompt;
    expect(text).toContain("readAdState");
    expect(text).toContain("postAdBrief");
    expect(text).toContain("proposalKey");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("keeps Daily manager to one agent, one daily 08:30 Schedule, built-in connectors only", () => {
    const manager = getPackageDefinition("manager")!;
    expect(manager.name).toBe("Daily manager");
    expect(manager.agents.map((a) => a.name)).toEqual(["Daily Manager"]);
    expect(manager.agents[0].model).toBe("sonnet");
    expect(manager.agents[0].toolToggles).toEqual({
      webSearch: false,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    });
    expect(manager.agents[0].instructions).toContain("readWorkspaceState");
    expect(manager.agents[0].instructions).toContain("postDailyBrief");
    expect(manager.schedules).toEqual([
      expect.objectContaining({
        agentKey: "manager",
        name: "Morning brief",
        scheduleKind: "daily",
        timeOfDay: 510,
      }),
    ]);
    expect(requiredConnectorTypes(manager)).toEqual([]);
    expect(manager.connectors).toEqual([
      { type: "company_memory", requirement: "built_in" },
    ]);
    const [workflow] = manager.workflows;
    expect(workflow.flow).toBe("sequence");
    expect(workflow.stages).toEqual([
      { order: 0, name: "Morning brief", agentKey: "manager", metricKey: "brief.last_run" },
    ]);
  });
});
