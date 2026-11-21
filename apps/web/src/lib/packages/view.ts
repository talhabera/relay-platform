import {
  PACKAGE_CATALOG,
  missingRequiredConnectors,
  type ConnectorCatalogType,
  type ConnectorRequirement,
  type PackageCardMetricKey,
  type PackageDefinition,
  type PackageSlug,
} from "@relay/db";
import { CONNECTOR_INFO } from "@/app/(dashboard)/settings/connectors/connector-view";

// Pure read model for Settings › Packages (spec 2026-10-02-packages,
// decisions 4-6 and 12; Figma 08c packages*). Installed and Available read
// from `package_installs`, never from agents.

export type PackageConnectorState =
  | "connected"
  /** Optional and not connected: shows "Optional", never "Missing". */
  | "optional"
  /** Required and not connected: the package's Schedules wait for it. */
  | "missing"
  | "built_in";

export type PackageConnectorView = {
  type: string;
  name: string;
  requirement: ConnectorRequirement;
  state: PackageConnectorState;
};

export type PackageCardView = {
  slug: PackageSlug;
  name: string;
  description: string;
  agentNames: string[];
  scheduleCount: number;
  connectors: PackageConnectorView[];
  cardMetricKey: PackageCardMetricKey;
  /** Null while Available. */
  installedAt: Date | null;
  /** Display names of missing required connectors; empty when nothing waits. */
  waitingFor: string[];
  /** Owner only (decision 5); members see the page read-only. */
  canInstall: boolean;
};

export type PackageInstallRow = { packageSlug: string; installedAt: Date };

const BUILT_IN_NAMES: Record<string, string> = {
  web_search: "Web search",
  company_memory: "Company memory",
};

export function connectorDisplayName(type: string): string {
  return (
    CONNECTOR_INFO[type as ConnectorCatalogType]?.name ??
    BUILT_IN_NAMES[type] ??
    type
  );
}

function connectorViews(
  definition: PackageDefinition,
  connected: ReadonlySet<string>,
): PackageConnectorView[] {
  return definition.connectors.map((c) => ({
    type: c.type,
    name: connectorDisplayName(c.type),
    requirement: c.requirement,
    state:
      c.requirement === "built_in"
        ? "built_in"
        : connected.has(c.type)
          ? "connected"
          : c.requirement === "required"
            ? "missing"
            : "optional",
  }));
}

export function buildPackageCards(input: {
  installs: readonly PackageInstallRow[];
  connectedTypes: Iterable<string>;
  isOwner: boolean;
}): PackageCardView[] {
  const connected = new Set(input.connectedTypes);
  const installedAt = new Map(
    input.installs.map((row) => [row.packageSlug, row.installedAt]),
  );
  return PACKAGE_CATALOG.map((definition) => {
    const at = installedAt.get(definition.slug) ?? null;
    return {
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      agentNames: definition.agents.map((a) => a.name),
      scheduleCount: definition.schedules.length,
      connectors: connectorViews(definition, connected),
      cardMetricKey: definition.cardMetricKey,
      installedAt: at,
      waitingFor:
        at === null
          ? []
          : missingRequiredConnectors(definition, connected).map(connectorDisplayName),
      canInstall: input.isOwner && at === null,
    };
  });
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Values behind a card's live line; each key has its own shape. */
export type PackageCardMetric =
  | { key: "workflow.weekly_target"; value: number; target: number }
  | { key: "posts.month_review"; posts: number; needReview: number; month: string }
  | { key: "report.last_run"; lastRunAt: Date | null; timezone: string };

/**
 * The card's live line (decision 12). "Waiting for <connectors>" wins while a
 * required connector is missing; null when the metric has no value yet.
 */
export function packageCardLine(
  card: Pick<PackageCardView, "installedAt" | "waitingFor">,
  metric: PackageCardMetric | null,
): string | null {
  if (card.installedAt === null) return null;
  if (card.waitingFor.length > 0) return `Waiting for ${joinNames(card.waitingFor)}`;
  if (!metric) return null;
  switch (metric.key) {
    case "workflow.weekly_target":
      return `${metric.value} of ${metric.target} qualified leads this week`;
    case "posts.month_review":
      return `${metric.posts} posts in ${metric.month}, ${metric.needReview} need review`;
    case "report.last_run": {
      if (!metric.lastRunAt) return "No analysis yet";
      const parts = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: metric.timezone,
      }).formatToParts(metric.lastRunAt);
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return `Last analysis ${part("weekday")} ${part("day")} ${part("month")}`;
    }
  }
}
