import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { StatusChip, type StatusTone } from "../primitives/status-chip";
import { CanvasPort, type CanvasPortTone } from "./canvas-port";

type CanvasAgentNodeState = "default" | "selected" | "paused";

type CanvasAgentNodeProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Immutable agent kind: sets the width (customer 324, operator 300) and the default icon. */
  kind: "operator" | "customer";
  name: string;
  /** Eyebrow above the name: the model for operator agents ("Claude Haiku"), "Customer agent" otherwise. */
  eyebrow: string;
  icon?: IconName;
  /** Status chip at the top right, e.g. `{ tone: "live", label: "v1 Live" }`. */
  status?: { tone: StatusTone; label: string };
  state?: CanvasAgentNodeState;
  /** Edge anchors. They are measured by the canvas surface and drawn only when `showPorts` is set. */
  ports?: readonly ("left" | "right")[];
  showPorts?: boolean;
  portTone?: CanvasPortTone;
};

const stateClass: Record<CanvasAgentNodeState, string> = {
  default: "border border-border shadow-elevation-1",
  paused: "border border-border shadow-elevation-1",
  selected: "border-[1.5px] border-primary shadow-glow-primary",
};

/**
 * Compact agent node of the read-only maps (Home agent map 04 `413:52694`; operator
 * overview lanes reuse it): avatar, eyebrow, name and a status chip. No metrics and no
 * menu; the full editing node is `CanvasAgentCard`.
 */
function CanvasAgentNode({
  className,
  kind,
  name,
  eyebrow,
  icon,
  status,
  state = "default",
  ports = [],
  showPorts = false,
  portTone = "idle",
  ...props
}: CanvasAgentNodeProps) {
  const paused = state === "paused";
  return (
    <div
      data-slot="canvas-agent-node"
      data-kind={kind}
      data-state={state}
      className={cn(
        "relative flex max-w-full items-start gap-3 rounded-xl bg-card p-3",
        kind === "customer" ? "w-81" : "w-75",
        stateClass[state],
        className,
      )}
      {...props}
    >
      <span
        data-slot="canvas-agent-node-avatar"
        aria-hidden
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
          paused ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary",
        )}
      >
        <Icon name={icon ?? (kind === "operator" ? "bot" : "messages-square")} size={24} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate type-label text-muted-foreground">{eyebrow}</span>
        <span data-slot="canvas-agent-node-name" className="type-h3 break-words text-foreground">
          {name}
        </span>
      </div>
      {status ? (
        <StatusChip tone={status.tone} className="shrink-0 uppercase">
          {status.label}
        </StatusChip>
      ) : null}
      {ports.map((side) => (
        <CanvasPort key={side} side={side} tone={portTone} className={showPorts ? undefined : "invisible"} />
      ))}
    </div>
  );
}

export { CanvasAgentNode };
export type { CanvasAgentNodeProps, CanvasAgentNodeState };
