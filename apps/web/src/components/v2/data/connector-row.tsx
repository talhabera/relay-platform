import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { IconButton } from "../primitives/icon-button";
import { StatusChip, type StatusTone } from "../primitives/status-chip";

/** Matches the code enum for connector status. */
type ConnectorRowStatus = "connected" | "disconnected" | "pending" | "error";

const STATUS: Record<
  ConnectorRowStatus,
  { tone: StatusTone; label: string; action: string; variant: "default" | "outline"; meta?: string }
> = {
  connected: { tone: "success", label: "Connected", action: "Configure", variant: "outline" },
  disconnected: { tone: "neutral", label: "Disconnected", action: "Connect", variant: "default", meta: "Not connected" },
  pending: { tone: "pending", label: "Pending", action: "Retry", variant: "outline", meta: "Waiting for authorization" },
  error: { tone: "error", label: "Error", action: "Reconnect", variant: "default" },
};

type ConnectorRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  status?: ConnectorRowStatus;
  brand: BrandName;
  name: string;
  description?: string;
  /** Right-aligned note: "Synced 25 Sep, 14:05", "Token expired 25 Sep, 08:12" (destructive on error). */
  meta?: string;
  /** Configure | Connect | Retry | Reconnect, by status. */
  onAction?: () => void;
  /** Figma BOOLEAN `menu`: ghost sm ellipsis Icon button at the right edge. */
  menu?: boolean;
  /** Replaces the ellipsis button when `menu` is on, e.g. a DropdownMenu trigger. */
  menuSlot?: React.ReactNode;
  onMenu?: () => void;
};

/**
 * Figma `Connector row` (02 `387:5094`): Settings › Connectors row. status connected | disconnected
 * | pending | error, each with its chip, note and action button.
 */
function ConnectorRow({
  className,
  status = "disconnected",
  brand,
  name,
  description,
  meta,
  onAction,
  menu = false,
  menuSlot,
  onMenu,
  ...props
}: ConnectorRowProps) {
  const s = STATUS[status];
  return (
    <div
      data-slot="connector-row"
      data-status={status}
      className={cn("flex w-full items-center gap-4 border-b border-border px-4 py-3", className)}
      {...props}
    >
      <span className="flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised p-2">
        <BrandGlyph brand={brand} size={24} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <span className="truncate type-body-strong text-foreground">{name}</span>
        {description ? <span className="truncate type-caption text-muted-foreground">{description}</span> : null}
      </div>
      <div className="flex w-32 shrink-0 items-center">
        <StatusChip tone={s.tone}>{s.label}</StatusChip>
      </div>
      <span
        data-slot="connector-row-meta"
        className={cn("w-44 shrink-0 text-right type-small", status === "error" ? "text-destructive" : "text-muted-foreground")}
      >
        {meta ?? s.meta}
      </span>
      <div className="flex w-30 shrink-0 items-center justify-end">
        <Button variant={s.variant} size="md" onClick={onAction}>
          {s.action}
        </Button>
      </div>
      {menu ? (menuSlot ?? <IconButton icon="ellipsis" label={`More for ${name}`} size="sm" onClick={onMenu} />) : null}
    </div>
  );
}

export { ConnectorRow };
export type { ConnectorRowProps, ConnectorRowStatus };
