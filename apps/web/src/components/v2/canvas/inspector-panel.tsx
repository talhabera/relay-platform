"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentChip } from "../primitives/agent-chip";
import { IconButton } from "../primitives/icon-button";
import { Segmented } from "../primitives/segmented";
import { StatusChip, type StatusTone } from "../primitives/status-chip";

const operatorInspectorTabs = [
  { value: "versions", label: "Versions" },
  { value: "tools", label: "Tools" },
  { value: "schedules", label: "Schedules" },
  { value: "access", label: "Access" },
  { value: "knowledge", label: "Knowledge" },
] as const;

const customerInspectorTabs = [
  { value: "sources", label: "Sources" },
  { value: "instructions", label: "Instructions" },
  { value: "knowledge", label: "Knowledge" },
  { value: "integrations", label: "Integrations" },
] as const;

type OperatorInspectorTab = (typeof operatorInspectorTabs)[number]["value"];
type CustomerInspectorTab = (typeof customerInspectorTabs)[number]["value"];

type InspectorAction = { label: string; onClick?: () => void; disabled?: boolean };

type InspectorPanelProps = Omit<React.ComponentProps<"aside">, "children"> & {
  kind: "operator" | "customer";
  name: string;
  description?: string;
  /** Operator: version shown in the Agent chip, e.g. "v2". */
  version?: string;
  /** Operator: version pill tone (default live when a version is given). */
  versionStatus?: "live" | "draft";
  /** Customer: Status chip beside the Agent chip. */
  status?: { tone: StatusTone; label: string };
  /** Active tab (OperatorInspectorTab | CustomerInspectorTab). Defaults to Tools / Sources. */
  tab?: OperatorInspectorTab | CustomerInspectorTab;
  onTabChange?: (tab: string) => void;
  /** Uppercase label over the content slot, e.g. "Tools · v2 Draft" or "Bound sources". */
  sectionLabel?: string;
  /** Content slot: swap children per tab (Tool toggle rows, Binding rows, ...). */
  children?: React.ReactNode;
  onClose?: () => void;
  secondaryAction?: InspectorAction;
  primaryAction?: InspectorAction;
  /** Custom footer content (e.g. dialog triggers); replaces secondaryAction / primaryAction. */
  footer?: React.ReactNode;
};

/**
 * Figma `Inspector panel` (02 `378:25922`): right-side inspector for the selected canvas node.
 * kind=operator: 440 wide, Agent chip with version, tabs Versions · Tools · Schedules · Access ·
 * Knowledge (Segmented items=5). kind=customer: 400 wide, Agent chip + Status chip, tabs
 * Sources · Instructions · Knowledge · Integrations. Footer holds a secondary + primary action.
 */
function InspectorPanel({
  className,
  kind,
  name,
  description,
  version,
  versionStatus,
  status,
  tab,
  onTabChange,
  sectionLabel,
  children,
  onClose,
  secondaryAction,
  primaryAction,
  footer,
  ...props
}: InspectorPanelProps) {
  const tabs = kind === "operator" ? operatorInspectorTabs : customerInspectorTabs;

  return (
    <aside
      data-slot="inspector-panel"
      data-kind={kind}
      aria-label={`${name} inspector`}
      className={cn(
        "flex max-w-full flex-col items-start overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-2",
        kind === "operator" ? "w-[440px]" : "w-[400px]",
        className,
      )}
      {...props}
    >
      <div className="flex w-full flex-col gap-3 border-b border-border p-5">
        <div className="flex w-full items-center gap-2">
          {kind === "operator" ? (
            <AgentChip
              kind="operator"
              name={name}
              version={version}
              status={versionStatus ?? (version ? "live" : "none")}
            />
          ) : (
            <>
              <AgentChip kind="customer" name={name} />
              {status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null}
            </>
          )}
          <span className="min-w-0 flex-1" />
          {onClose ? <IconButton icon="x" label="Close inspector" size="sm" onClick={onClose} /> : null}
        </div>
        {description ? <p className="w-full type-small text-muted-foreground">{description}</p> : null}
        <Segmented
          aria-label={`${name} sections`}
          items={tabs.map((t) => ({ value: t.value, label: t.label }))}
          value={tab ?? tabs[kind === "operator" ? 1 : 0].value}
          onValueChange={onTabChange}
        />
      </div>
      <div data-slot="inspector-content" className="flex w-full flex-col gap-1 p-5">
        {sectionLabel ? <span className="type-label text-muted-foreground">{sectionLabel}</span> : null}
        {children}
      </div>
      {footer ? (
        <div data-slot="inspector-footer" className="flex w-full items-start gap-3 border-t border-border px-5 py-4">
          {footer}
        </div>
      ) : secondaryAction || primaryAction ? (
        <div data-slot="inspector-footer" className="flex w-full items-start gap-3 border-t border-border px-5 py-4">
          {secondaryAction ? (
            <Button
              variant="outline"
              size="md"
              className="min-w-0 flex-1"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          {primaryAction ? (
            <Button
              size="md"
              className="min-w-0 flex-1"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

export { customerInspectorTabs, InspectorPanel, operatorInspectorTabs };
export type { CustomerInspectorTab, InspectorAction, InspectorPanelProps, OperatorInspectorTab };
