import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Chip } from "../primitives/chip";
import { Icon, type IconName } from "../primitives/icon";
import { StatusChip, type StatusTone } from "../primitives/status-chip";

type PackageState = "installed" | "available" | "needs-connector";
type ConnectorState = "connected" | "missing" | "optional" | "warning" | "built_in";

type PackageConnector = {
  /** Brand glyph for an account connector; built-in capabilities pass `icon` instead. */
  brand?: BrandName;
  icon?: IconName;
  name: string;
  state: ConnectorState;
  /** Overrides the state label, e.g. "Quota reached, 06:00" for a warning. */
  detail?: string;
};

const stateChip: Record<PackageState, { tone: StatusTone; label: string }> = {
  installed: { tone: "success", label: "Installed" },
  available: { tone: "neutral", label: "Available" },
  "needs-connector": { tone: "pending", label: "Waiting" },
};

const connectorStyle: Record<ConnectorState, { icon: IconName; label: string; fg: string }> = {
  connected: { icon: "circle-check", label: "Connected", fg: "text-success" },
  missing: { icon: "circle-alert", label: "Missing", fg: "text-warning" },
  optional: { icon: "circle", label: "Optional", fg: "text-muted-foreground" },
  warning: { icon: "triangle-alert", label: "Warning", fg: "text-warning" },
  built_in: { icon: "circle-check", label: "Built in", fg: "text-muted-foreground" },
};

const actionStyle: Record<PackageState, { icon: IconName; variant: "default" | "outline" }> = {
  installed: { icon: "workflow", variant: "outline" },
  available: { icon: "package", variant: "default" },
  "needs-connector": { icon: "plug", variant: "default" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type PackageCardProps = Omit<React.ComponentProps<"article">, "children"> & {
  state: PackageState;
  name: string;
  tagline: string;
  /** What the package adds (agents / workflows / schedules chips). */
  adds: { agents: number; workflows: number; schedules: number };
  connectors: PackageConnector[];
  /** Live fact (installed) or the waiting message (needs-connector). */
  fact?: string;
  /** Icon of the installed fact line (default `trending-up`). */
  factIcon?: IconName;
  /** Installed line, e.g. "Installed Tue 1 Sep 2026". Not shown when available. */
  installedLabel?: string;
  /** Primary action label: "Open in Operator", "Install", "Connect Meta". */
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  /** Read-only viewers (members) see no action. */
  readOnly?: boolean;
};

/**
 * Figma `Package card` (02 `518:69717`): company package in Settings > Packages.
 * installed (success chip, live fact, installed date, Open in Operator) | available
 * (neutral, Install) | needs-connector (pending, paused until a required connector is
 * connected). Chips = what it adds; connector rows = Brand glyph + state. No uninstall.
 */
function PackageCard({
  className,
  state,
  name,
  tagline,
  adds,
  connectors,
  fact,
  factIcon = "trending-up",
  installedLabel,
  actionLabel,
  actionHref,
  onAction,
  readOnly = false,
  ...props
}: PackageCardProps) {
  const chip = stateChip[state];
  const action = actionStyle[state];
  const showInstalled = state !== "available";
  const builtInOnly = connectors.length > 0 && connectors.every((c) => c.state === "built_in");
  const actionContent = (
    <>
      <Icon name={action.icon} size={16} />
      {actionLabel}
    </>
  );

  return (
    <article
      data-slot="package-card"
      data-state={state}
      className={cn("flex w-full flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-elevation-1", className)}
      {...props}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon name="package" size={20} />
        </span>
        <span className="flex-1" />
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="type-h3 text-foreground">{name}</h3>
        <p className="type-small text-muted-foreground">{tagline}</p>
      </div>

      <div data-slot="package-adds" className="flex flex-wrap gap-2">
        <Chip asStatic icon="bot">
          {plural(adds.agents, "agent")}
        </Chip>
        <Chip asStatic icon="workflow">
          {plural(adds.workflows, "workflow")}
        </Chip>
        <Chip asStatic icon="calendar-clock">
          {plural(adds.schedules, "schedule")}
        </Chip>
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-label text-muted-foreground">
          {builtInOnly ? "No connectors needed" : "Connectors"}
        </span>
        <ul className="flex flex-col gap-2">
          {connectors.map((c) => {
            const s = connectorStyle[c.state];
            return (
              <li key={c.name} data-slot="package-connector" data-state={c.state} className="flex items-center gap-2">
                {c.brand ? (
                  <BrandGlyph brand={c.brand} size={16} />
                ) : (
                  <Icon name={c.icon ?? "plug"} size={16} className="shrink-0 text-foreground" />
                )}
                <span className="min-w-0 flex-1 type-small text-foreground">{c.name}</span>
                <span className={cn("flex shrink-0 items-center gap-1 whitespace-nowrap type-caption", s.fg)}>
                  <Icon name={s.icon} size={14} />
                  {c.detail ?? s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {showInstalled && fact ? (
        <div
          data-slot="package-fact"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2",
            state === "needs-connector" ? "bg-status-needs-you text-status-needs-you-foreground" : "bg-muted text-foreground",
          )}
        >
          <Icon
            name={state === "needs-connector" ? "triangle-alert" : factIcon}
            size={16}
            className={state === "needs-connector" ? undefined : "text-primary"}
          />
          <span className="min-w-0 flex-1 type-body-strong">{fact}</span>
        </div>
      ) : null}

      {showInstalled && installedLabel ? (
        <div className="flex items-center gap-2 type-caption text-muted-foreground">
          <Icon name="circle-check" size={14} />
          <span className="min-w-0 flex-1">{installedLabel}</span>
        </div>
      ) : null}

      <div aria-hidden className="h-px w-full bg-border" />

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 type-caption text-muted-foreground">
          <Icon name="shield" size={14} />
          <span className="min-w-0 flex-1">Nothing leaves Relay without a checkpoint</span>
        </div>
        {readOnly ? null : actionHref ? (
          <Button asChild variant={action.variant} className="w-full">
            <Link href={actionHref}>{actionContent}</Link>
          </Button>
        ) : (
          <Button variant={action.variant} className="w-full" onClick={onAction}>
            {actionContent}
          </Button>
        )}
      </div>
    </article>
  );
}

export { PackageCard };
export type { ConnectorState, PackageCardProps, PackageConnector, PackageState };
