import { describe, expect, it } from "vitest";
import { PACKAGE_CATALOG } from "@relay/db";
import { isMetricKey } from "@/lib/workflows/metrics";
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflows/write";
import { buildPackageCards, joinNames, packageCardLine } from "./view";

const installedAt = new Date("2026-09-21T09:00:00Z");

describe("package catalog vs the workflow model", () => {
  it.each(PACKAGE_CATALOG.flatMap((p) => p.workflows.map((w) => [p.slug, w] as const)))(
    "%s workflow passes the workflow definition checks",
    (slug, w) => {
      const def: WorkflowDefinition = {
        packageSlug: slug,
        name: w.name,
        flow: w.flow,
        weeklyTarget: w.weeklyTarget,
        targetMetricKey: w.targetMetricKey as WorkflowDefinition["targetMetricKey"],
        inboundStageOrder: w.inboundStageOrder,
        intake: [...w.intake],
        stages: w.stages.map((s) => ({
          order: s.order,
          name: s.name,
          agentId: s.agentKey,
          metricKey: s.metricKey as WorkflowDefinition["stages"][number]["metricKey"],
        })),
      };
      expect(() => validateWorkflowDefinition(def)).not.toThrow();
      for (const s of w.stages) expect(isMetricKey(s.metricKey), s.metricKey).toBe(true);
    },
  );
});

describe("buildPackageCards", () => {
  it("shows every catalog package as Available with Install for the owner", () => {
    const cards = buildPackageCards({ installs: [], connectedTypes: [], isOwner: true });
    expect(cards.map((c) => c.slug)).toEqual(["lead-engine", "social-media", "insights", "manager", "ad-monitor", "ad-manager"]);
    expect(cards.every((c) => c.installedAt === null && c.canInstall)).toBe(true);
    expect(cards.every((c) => c.waitingFor.length === 0)).toBe(true);
  });

  it("is read-only for members", () => {
    const cards = buildPackageCards({ installs: [], connectedTypes: [], isOwner: false });
    expect(cards.some((c) => c.canInstall)).toBe(false);
  });

  it("reads Installed from install rows and marks Lead engine connectors Optional, not Missing", () => {
    const [lead] = buildPackageCards({
      installs: [{ packageSlug: "lead-engine", installedAt }],
      connectedTypes: ["hunter"],
      isOwner: true,
    });
    expect(lead.installedAt).toBe(installedAt);
    expect(lead.canInstall).toBe(false);
    expect(lead.scheduleCount).toBe(3);
    expect(Object.fromEntries(lead.connectors.map((c) => [c.type, c.state]))).toEqual({
      google_places: "optional",
      hunter: "connected",
      snov: "optional",
      google_workspace: "optional",
      web_search: "built_in",
      company_memory: "built_in",
    });
  });

  it("an installed Social media without its required connectors is waiting", () => {
    const cards = buildPackageCards({
      installs: [{ packageSlug: "social-media", installedAt }],
      connectedTypes: [],
      isOwner: true,
    });
    const social = cards.find((c) => c.slug === "social-media")!;
    expect(social.waitingFor).toEqual(["Meta", "Google Business Profile"]);
    expect(social.connectors.find((c) => c.type === "meta")?.state).toBe("missing");
    expect(packageCardLine(social, null)).toBe("Waiting for Meta and Google Business Profile");
  });
});

describe("packageCardLine", () => {
  const card = { installedAt, waitingFor: [] };

  it("formats each card metric key", () => {
    expect(
      packageCardLine(card, { key: "workflow.weekly_target", value: 6, target: 10 }),
    ).toBe("6 of 10 qualified leads this week");
    expect(
      packageCardLine(card, { key: "posts.month_review", posts: 12, needReview: 3, month: "October" }),
    ).toBe("12 posts in October, 3 need review");
    expect(
      packageCardLine(card, {
        key: "report.last_run",
        lastRunAt: new Date("2026-09-21T06:00:00Z"),
        timezone: "Europe/Istanbul",
      }),
    ).toBe("Last analysis Mon 21 Sep");
  });

  it("is empty for an Available package", () => {
    expect(packageCardLine({ installedAt: null, waitingFor: [] }, null)).toBeNull();
  });

  it("joins names", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
