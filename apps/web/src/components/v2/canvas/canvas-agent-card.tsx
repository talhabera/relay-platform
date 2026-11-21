import * as React from "react";

import { cn } from "@/lib/utils";

import { AgentChip } from "../primitives/agent-chip";
import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { StatusChip } from "../primitives/status-chip";
import { CanvasPort, type CanvasPortTone } from "./canvas-port";

type CanvasAgentCardState = "default" | "selected" | "paused" | "error";

type CanvasAgentMetric = { value: React.ReactNode; label: string };

type CanvasAgentCardProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Immutable agent kind. Customer cards take source edges on the left; operator cards send to connectors on the right. */
  kind: "operator" | "customer";
  name: string;
  description?: string;
  /** Model label shown in the Agent chip, e.g. "Claude Haiku". */
  model: string;
  /** Operator only: live version label (e.g. "v1"); shown as "v1 Live" in the chip. */
  version?: string;
  state?: CanvasAgentCardState;
  /** Two metric tiles (value + label). */
  metrics: [CanvasAgentMetric, CanvasAgentMetric];
  /** Connector (operator) or source (customer) glyphs in the footer row. */
  glyphs?: BrandName[];
  /** Inline alert text in state error, e.g. "Google Places quota reached · 06:00". */
  alert?: string;
  /** Header menu. undefined renders the default ellipsis IconButton; null hides it. */
  menu?: React.ReactNode;
};

const borderClass: Record<CanvasAgentCardState, string> = {
  default: "border border-border shadow-elevation-1",
  paused: "border border-border shadow-elevation-1",
  selected: "border-[1.5px] border-primary shadow-glow-primary",
  error: "border-[1.5px] border-destructive shadow-elevation-1",
};

const portTone: Record<CanvasAgentCardState, CanvasPortTone> = {
  default: "idle",
  paused: "idle",
  selected: "active",
  error: "error",
};

/**
 * Figma `Canvas agent card` (02 `375:23496`): 360 wide agent node on the Agents canvas.
 * kind operator | customer x state default | selected (teal border + glow, one per view) |
 * paused | error (inline alert). Operator chip shows model + live version; customer cards
 * show a Live chip instead. Operator port is right (to connectors), customer port left (from sources).
 */
function CanvasAgentCard({
  className,
  kind,
  name,
  description,
  model,
  version,
  state = "default",
  metrics,
  glyphs = [],
  alert,
  menu,
  ...props
}: CanvasAgentCardProps) {
  const paused = state === "paused";
  const statusChip =
    state === "error" ? (
      <StatusChip tone="error">Error</StatusChip>
    ) : paused ? (
      <StatusChip tone="neutral">Paused</StatusChip>
    ) : kind === "customer" ? (
      <StatusChip tone="live">Live</StatusChip>
    ) : null;

  return (
    <div
      data-slot="canvas-agent-card"
      data-kind={kind}
      data-state={state}
      className={cn(
        "relative flex w-[360px] max-w-full flex-col items-start gap-4 rounded-xl bg-card p-5",
        borderClass[state],
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-start gap-3">
        <span
          data-slot="canvas-agent-avatar"
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
            paused ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary",
          )}
        >
          <Icon name={kind === "operator" ? "bot" : "messages-square"} size={24} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-label text-muted-foreground">
            {kind === "operator" ? "Operator agent" : "Customer agent"}
          </span>
          <span data-slot="canvas-agent-name" className="type-h3 break-words text-foreground">
            {name}
          </span>
        </div>
        {menu === undefined ? <IconButton icon="ellipsis" label={`${name} actions`} size="sm" /> : menu}
      </div>
      {description ? <p className="w-full type-small text-muted-foreground">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <AgentChip
          kind={kind}
          name={model}
          version={kind === "operator" ? version : undefined}
          status={kind === "operator" && version ? "live" : "none"}
        />
        {statusChip}
      </div>
      {state === "error" && alert ? (
        // Neutral fill (Figma 375:22635 renders #0b1113 on the #0d1316 card), not a red tint.
        <div
          data-slot="canvas-agent-alert"
          role="alert"
          className="flex w-full items-center gap-2 rounded-lg border border-destructive/20 bg-canvas/50 px-3 py-2"
        >
          <Icon name="circle-alert" size={16} className="text-destructive" />
          <span className="min-w-0 flex-1 type-small text-foreground">{alert}</span>
        </div>
      ) : null}
      <div className="flex w-full items-start gap-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            data-slot="canvas-agent-metric"
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg bg-surface-raised p-3"
          >
            <span className="type-h3 whitespace-nowrap text-foreground">{metric.value}</span>
            <span className="type-caption text-muted-foreground">{metric.label}</span>
          </div>
        ))}
      </div>
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 type-label text-muted-foreground">
          {kind === "operator" ? "Connectors" : "Sources"}
        </span>
        {glyphs.length > 0 ? (
          <span data-slot="canvas-agent-glyphs" className="flex items-start gap-1">
            {glyphs.map((brand) => (
              <BrandGlyph key={brand} brand={brand} size={16} label={brand} />
            ))}
          </span>
        ) : null}
      </div>
      <CanvasPort side={kind === "operator" ? "right" : "left"} tone={portTone[state]} />
    </div>
  );
}

export { CanvasAgentCard };
export type { CanvasAgentCardProps, CanvasAgentCardState, CanvasAgentMetric };
