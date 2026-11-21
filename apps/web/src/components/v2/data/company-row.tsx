import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { StatusChip } from "../primitives/status-chip";

type CompanyRowState = "current" | "default";

type CompanyRowProps = Omit<React.ComponentProps<"div">, "children" | "role"> & {
  state?: CompanyRowState;
  name: string;
  description?: string;
  /** Role chip label, e.g. "Owner". */
  role: string;
  /** e.g. "2 customer · 5 operator agents". */
  meta?: string;
  /** Default rows: the outline "Switch" button. */
  onSwitch?: () => void;
  /** Replaces the ellipsis button, e.g. a DropdownMenu trigger. */
  actions?: React.ReactNode;
  onMenu?: () => void;
};

/**
 * Figma `Company row` (02 `399:5059`): Settings › Companies list row. state current (building
 * tile on primary-soft, live "Current" chip) | default (muted tile, outline Switch button).
 */
function CompanyRow({
  className,
  state = "default",
  name,
  description,
  role,
  meta,
  onSwitch,
  actions,
  onMenu,
  ...props
}: CompanyRowProps) {
  const current = state === "current";
  return (
    <div
      data-slot="company-row"
      data-state={state}
      className={cn("flex w-full items-center gap-4 border-b border-border px-4 py-3", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <span
          data-slot="company-row-tile"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md p-2",
            current ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon name="building-2" size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate type-body-strong text-foreground">{name}</span>
          {description ? <span className="truncate type-caption text-muted-foreground">{description}</span> : null}
        </div>
      </div>
      <div className="flex w-24 shrink-0 items-center overflow-hidden">
        <StatusChip tone="neutral" dot={false}>
          {role}
        </StatusChip>
      </div>
      <div className="flex w-27.5 shrink-0 items-center">
        {current ? (
          <StatusChip tone="live">Current</StatusChip>
        ) : (
          <Button variant="outline" size="md" onClick={onSwitch}>
            Switch
          </Button>
        )}
      </div>
      <span className="w-47.5 shrink-0 type-small text-muted-foreground">{meta}</span>
      {actions ?? <IconButton icon="ellipsis" label={`Actions for ${name}`} size="sm" onClick={onMenu} />}
    </div>
  );
}

export { CompanyRow };
export type { CompanyRowProps, CompanyRowState };
