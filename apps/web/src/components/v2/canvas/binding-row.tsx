import * as React from "react";

import { cn } from "@/lib/utils";

import { AgentChip } from "../primitives/agent-chip";
import { BrandGlyph } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { StatusChip } from "../primitives/status-chip";
import { sourceLabel, type CanvasSource } from "./source-node";

/** live = active binding, paused = neutral chip, error. */
type BindingStatus = "live" | "paused" | "error";

const statusChip: Record<BindingStatus, React.ReactNode> = {
  live: <StatusChip tone="live">Live</StatusChip>,
  paused: <StatusChip tone="neutral">Paused</StatusChip>,
  error: <StatusChip tone="error">Error</StatusChip>,
};

type BindingRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  source: CanvasSource;
  /** Defaults to the source's label, e.g. "Website widget". */
  name?: string;
  /** Bound customer agent. Omit inside an agent inspector (Figma `agent=false`). */
  agent?: string;
  status?: BindingStatus;
  /** undefined renders the default ellipsis IconButton; null hides it. */
  menu?: React.ReactNode;
};

/**
 * Figma `Binding row` (02 `375:25218`): 48 high source-to-agent binding, customer agents only.
 * Brand glyph, source name, optional arrow + Agent chip, Status chip, menu.
 */
function BindingRow({ className, source, name, agent, status = "live", menu, ...props }: BindingRowProps) {
  const label = name ?? sourceLabel[source];
  return (
    <div
      data-slot="binding-row"
      data-status={status}
      className={cn(
        "flex h-12 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
        className,
      )}
      {...props}
    >
      <BrandGlyph brand={source} size={24} />
      <span className="truncate type-body-strong text-foreground">{label}</span>
      {agent ? (
        <>
          <Icon name="arrow-right" size={16} className="text-muted-foreground" />
          <AgentChip kind="customer" name={agent} />
        </>
      ) : null}
      <span className="min-w-0 flex-1" />
      {statusChip[status]}
      {menu === undefined ? <IconButton icon="ellipsis" label={`${label} binding actions`} size="sm" /> : menu}
    </div>
  );
}

export { BindingRow };
export type { BindingRowProps, BindingStatus };
