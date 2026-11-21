import {
  getPackageDefinition,
  type PackageScheduleDefinition,
  type PackageSlug,
} from "@relay/db";
import { joinNames, packageCardLine, type PackageCardMetric, type PackageCardView } from "@/lib/packages";
import type { BrandName, IconName } from "@/components/v2/primitives";
import type { PackageCardProps, PackageConnector } from "@/components/v2/work";
import { CONNECTOR_INFO } from "../connectors/connector-view";

// Settings › Packages view model (Figma 08c `packages*`, spec 2026-10-02-packages).
// Pure: the page loads `getPackageCards` and hands the result here.

export type InstallConnector = { type: string; name: string; brand?: BrandName };

/** What the install dialog shows (Figma `08/settings/packages-install`). */
export type InstallSummary = {
  slug: PackageSlug;
  name: string;
  title: string;
  description: string;
  agents: string[];
  workflows: string[];
  schedules: string[];
  /** Required connectors not connected yet; the Schedules wait for them. */
  connectFirst: InstallConnector[];
  /** Sentence naming the optional connectors still unconnected, or null. */
  optionalNote: string | null;
};

type CardProps = Pick<
  PackageCardProps,
  | "state"
  | "name"
  | "tagline"
  | "adds"
  | "fact"
  | "factIcon"
  | "installedLabel"
  | "actionLabel"
  | "actionHref"
  | "readOnly"
> & { connectors: PackageConnector[] };

export type PackageCardModel = {
  slug: PackageSlug;
  card: CardProps;
  /** Null when Install is not offered (installed, or a member). */
  install: InstallSummary | null;
};

const BUILT_IN_ICONS: Record<string, IconName> = {
  web_search: "globe",
  company_memory: "database",
};

const FACT_ICONS: Record<PackageCardView["cardMetricKey"], IconName> = {
  "workflow.weekly_target": "trending-up",
  "posts.month_review": "calendar-clock",
  "report.last_run": "history",
  "brief.last_run": "sun",
};

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "daily 07:00" | "Mondays 09:00" (company timezone). */
export function scheduleWhen(
  schedule:
    | { scheduleKind: "daily"; timeOfDay: number }
    | { scheduleKind: "weekly"; weekday: number; timeOfDay: number },
): string {
  return schedule.scheduleKind === "weekly"
    ? `${WEEKDAYS[schedule.weekday] ?? "Weekly"} ${hhmm(schedule.timeOfDay)}`
    : `daily ${hhmm(schedule.timeOfDay)}`;
}

/** "Installed Tue 1 Sep 2026" in the company timezone. */
export function installedLabel(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `Installed ${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

function brandOf(type: string): BrandName | undefined {
  return CONNECTOR_INFO[type as keyof typeof CONNECTOR_INFO]?.brand;
}

function cardConnectors(view: PackageCardView): PackageConnector[] {
  return view.connectors.map((c) =>
    c.state === "built_in"
      ? { name: c.name, state: "built_in", icon: BUILT_IN_ICONS[c.type] ?? "circle-check" }
      : { name: c.name, state: c.state, brand: brandOf(c.type) },
  );
}

function installSummary(view: PackageCardView, companyName: string): InstallSummary {
  const definition = getPackageDefinition(view.slug);
  const schedules: readonly PackageScheduleDefinition[] = definition?.schedules ?? [];
  const connectFirst = view.connectors
    .filter((c) => c.state === "missing")
    .map((c) => ({ type: c.type, name: c.name, brand: brandOf(c.type) }));
  const optional = view.connectors.filter((c) => c.state === "optional").map((c) => c.name);
  return {
    slug: view.slug,
    name: view.name,
    title: `Install ${view.name} on ${companyName}`,
    description:
      `Adds a ready-made ${view.name} setup to ${companyName}.` +
      (connectFirst.length > 0 ? " It starts once the required connectors are connected." : ""),
    agents: view.agentNames,
    workflows: (definition?.workflows ?? []).map((w) => w.name),
    schedules: schedules.map((s) => `${s.name} · ${scheduleWhen(s)}`),
    connectFirst,
    optionalNote:
      optional.length === 0
        ? null
        : optional.length === 1
          ? `${optional[0]} is optional. You can connect it later in Connectors.`
          : `${joinNames(optional)} are optional. You can connect them later in Connectors.`,
  };
}

export function packageCardModels(
  views: readonly PackageCardView[],
  context: {
    companyName: string;
    timezone: string;
    isOwner: boolean;
    /** Card metric values by slug. No source yet: absent keys hide the live line. */
    metrics: Partial<Record<PackageSlug, PackageCardMetric>>;
  },
): PackageCardModel[] {
  return views.map((view) => {
    const definition = getPackageDefinition(view.slug);
    const installed = view.installedAt !== null;
    const waiting = installed && view.waitingFor.length > 0;
    const line = packageCardLine(view, context.metrics[view.slug] ?? null);
    const adds = {
      agents: view.agentNames.length,
      workflows: definition?.workflows.length ?? 0,
      schedules: view.scheduleCount,
    };
    const base = {
      name: view.name,
      tagline: view.description,
      adds,
      connectors: cardConnectors(view),
    };

    if (!installed) {
      return {
        slug: view.slug,
        card: { ...base, state: "available", actionLabel: "Install", readOnly: !view.canInstall },
        install: view.canInstall ? installSummary(view, context.companyName) : null,
      };
    }

    return {
      slug: view.slug,
      card: {
        ...base,
        state: waiting ? "needs-connector" : "installed",
        fact: line ?? undefined,
        factIcon: FACT_ICONS[view.cardMetricKey],
        installedLabel: installedLabel(view.installedAt as Date, context.timezone),
        actionLabel: waiting ? `Connect ${view.waitingFor[0]}` : "Open in Operator",
        actionHref: waiting ? "/settings/connectors" : "/operator",
        // Members cannot connect connectors; opening Operator stays available to them.
        readOnly: waiting && !context.isOwner,
      },
      install: null,
    };
  });
}
