import * as React from "react";

import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { CanvasPort, type CanvasPortTone } from "./canvas-port";

/** Mirrors packages/db `integrations.status`. */
type ConnectorNodeStatus = "connected" | "disconnected" | "pending" | "error";

const defaultStatusText: Record<ConnectorNodeStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  pending: "Pending",
  error: "Error · check API key",
};

const dotClass: Record<ConnectorNodeStatus, string> = {
  connected: "bg-success",
  disconnected: "bg-muted-foreground",
  pending: "bg-warning",
  error: "bg-destructive",
};

const portTone: Record<ConnectorNodeStatus, CanvasPortTone> = {
  connected: "active",
  disconnected: "idle",
  pending: "pending",
  error: "error",
};

type ConnectorNodeProps = Omit<React.ComponentProps<"div">, "children"> & {
  brand: BrandName;
  name: string;
  status?: ConnectorNodeStatus;
  statusText?: string;
};

/**
 * Figma `Connector node` (02 `375:25081`): 240 wide operator connector on the Agents canvas.
 * status connected | disconnected | pending | error. Left port takes edges from operator cards.
 */
function ConnectorNode({ className, brand, name, status = "connected", statusText, ...props }: ConnectorNodeProps) {
  return (
    <div
      data-slot="connector-node"
      data-status={status}
      className={cn(
        "relative flex w-60 max-w-full items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-elevation-1",
        status === "error" ? "border-[1.5px] border-destructive" : "border border-border",
        className,
      )}
      {...props}
    >
      <BrandGlyph brand={brand} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate type-body-strong text-foreground">{name}</span>
        <span className="flex items-center gap-2">
          <span data-slot="connector-node-dot" aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass[status])} />
          <span className="truncate type-caption text-muted-foreground">{statusText ?? defaultStatusText[status]}</span>
        </span>
      </div>
      <CanvasPort side="left" tone={portTone[status]} />
    </div>
  );
}

export { ConnectorNode };
export type { ConnectorNodeProps, ConnectorNodeStatus };
