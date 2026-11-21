import { describe, expect, it } from "vitest";
import { buildPackageCards } from "@/lib/packages";

import { installedLabel, packageCardModels, scheduleWhen } from "./package-view";

const SEP_1 = new Date("2026-09-01T10:00:00Z");

function models(input: {
  installs?: { packageSlug: string; installedAt: Date }[];
  connected?: string[];
  isOwner?: boolean;
}) {
  const cards = buildPackageCards({
    installs: input.installs ?? [],
    connectedTypes: input.connected ?? [],
    isOwner: input.isOwner ?? true,
  });
  return packageCardModels(cards, {
    companyName: "Acme GmbH",
    timezone: "UTC",
    isOwner: input.isOwner ?? true,
    metrics: {},
  });
}

const bySlug = (list: ReturnType<typeof models>, slug: string) => {
  const found = list.find((m) => m.slug === slug);
  if (!found) throw new Error(`missing ${slug}`);
  return found;
};

describe("packageCardModels", () => {
  it("lists the six catalog packages, all available for an owner with no installs", () => {
    const list = models({});
    expect(list.map((m) => m.slug)).toEqual(["lead-engine", "social-media", "insights", "manager", "ad-monitor", "ad-manager"]);
    expect(list.every((m) => m.card.state === "available")).toBe(true);
    expect(list.every((m) => m.card.actionLabel === "Install" && !m.card.readOnly)).toBe(true);
    expect(list.every((m) => m.install !== null)).toBe(true);
  });

  it("Lead engine card: 3 agents, 3 schedules, optional connectors never read Missing", () => {
    const lead = bySlug(models({ connected: ["hunter"] }), "lead-engine");
    expect(lead.card.adds).toEqual({ agents: 3, workflows: 1, schedules: 3 });
    const states = Object.fromEntries(lead.card.connectors.map((c) => [c.name, c.state]));
    expect(states.Hunter).toBe("connected");
    expect(states["Google Places"]).toBe("optional");
    expect(Object.values(states)).not.toContain("missing");
    expect(lead.card.connectors.find((c) => c.name === "Hunter")?.brand).toBe("hunter");
  });

  it("built-in connectors carry an icon instead of a brand", () => {
    const insights = bySlug(models({}), "insights");
    expect(insights.card.connectors.map((c) => [c.name, c.state, c.icon, c.brand])).toEqual([
      ["Web search", "built_in", "globe", undefined],
      ["Company memory", "built_in", "database", undefined],
    ]);
  });

  it("installed: Open in Operator, installed date, and no fact line while the metric has no value", () => {
    const lead = bySlug(models({ installs: [{ packageSlug: "lead-engine", installedAt: SEP_1 }] }), "lead-engine");
    expect(lead.card.state).toBe("installed");
    expect(lead.card.actionLabel).toBe("Open in Operator");
    expect(lead.card.actionHref).toBe("/operator");
    expect(lead.card.installedLabel).toBe("Installed Tue 1 Sep 2026");
    expect(lead.card.fact).toBeUndefined();
    expect(lead.install).toBeNull();
  });

  it("installed with a metric value shows the live line", () => {
    const cards = buildPackageCards({
      installs: [{ packageSlug: "lead-engine", installedAt: SEP_1 }],
      connectedTypes: [],
      isOwner: true,
    });
    const [lead] = packageCardModels(cards, {
      companyName: "Acme",
      timezone: "UTC",
      isOwner: true,
      metrics: { "lead-engine": { key: "workflow.weekly_target", value: 6, target: 10 } },
    });
    expect(lead.card.fact).toBe("6 of 10 qualified leads this week");
  });

  it("installed without a required connector: waiting state, line and Connect action", () => {
    const social = bySlug(
      models({ installs: [{ packageSlug: "social-media", installedAt: SEP_1 }], connected: ["meta"] }),
      "social-media",
    );
    expect(social.card.state).toBe("needs-connector");
    expect(social.card.fact).toBe("Waiting for Google Business Profile");
    expect(social.card.actionLabel).toBe("Connect Google Business Profile");
    expect(social.card.actionHref).toBe("/settings/connectors");
  });

  it("members see the page read-only: no action, no install dialog", () => {
    const list = models({ isOwner: false, installs: [{ packageSlug: "insights", installedAt: SEP_1 }] });
    expect(bySlug(list, "lead-engine").card.readOnly).toBe(true);
    expect(bySlug(list, "lead-engine").install).toBeNull();
    // Opening the installed package in Operator is still allowed.
    expect(bySlug(list, "insights").card.readOnly).toBe(false);
    const waiting = models({ isOwner: false, installs: [{ packageSlug: "social-media", installedAt: SEP_1 }] });
    expect(bySlug(waiting, "social-media").card.readOnly).toBe(true);
  });

  it("install summary: agents, workflow stages, schedules, required and optional connectors", () => {
    const social = bySlug(models({ connected: ["linkedin"] }), "social-media");
    expect(social.install).toMatchObject({
      slug: "social-media",
      title: "Install Social media on Acme GmbH",
      agents: ["Social Media Manager"],
      schedules: ["Content calendar · Mondays 09:00", "Review check · daily 10:00"],
      connectFirst: [
        { name: "Meta", brand: "meta" },
        { name: "Google Business Profile", brand: "google-business" },
      ],
      optionalNote: "Trustpilot is optional. You can connect it later in Connectors.",
    });
    expect(social.install?.description).toContain("starts once the required connectors are connected");
    const lead = bySlug(models({}), "lead-engine");
    expect(lead.install?.connectFirst).toEqual([]);
    expect(lead.install?.optionalNote).toBe(
      "Google Places, Hunter, Snov.io and Google Workspace are optional. You can connect them later in Connectors.",
    );
  });
});

describe("scheduleWhen", () => {
  it("formats daily and weekly times", () => {
    expect(scheduleWhen({ scheduleKind: "daily", timeOfDay: 420 })).toBe("daily 07:00");
    expect(scheduleWhen({ scheduleKind: "weekly", weekday: 1, timeOfDay: 540 })).toBe("Mondays 09:00");
  });
});

describe("installedLabel", () => {
  it("uses the company timezone", () => {
    expect(installedLabel(new Date("2026-09-01T23:30:00Z"), "Europe/Istanbul")).toBe("Installed Wed 2 Sep 2026");
  });
});
