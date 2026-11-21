"use client";

import * as React from "react";

import { Switch } from "@/components/ui/switch";
import type { OperatorToolId } from "@/lib/operator/tool-catalog";
import { cn } from "@/lib/utils";

import { Chip } from "../primitives/chip";
import { Icon, type IconName } from "../primitives/icon";

/** Figma inspector Tools icons per `tool-catalog.ts` id. */
const operatorToolIcon: Record<OperatorToolId, IconName> = {
  webSearch: "globe",
  excel: "table",
  companyMemory: "database",
  proposeAction: "sparkles",
  whatsappNotification: "message-circle",
};

type ToolToggleRowState = "on" | "off" | "coming-soon";

type ToolToggleRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
  /** Figma `icon` instance swap (default Icon/globe). */
  icon?: IconName;
  state?: ToolToggleRowState;
  onCheckedChange?: (checked: boolean) => void;
  /** Disables the switch for read-only viewers (coming-soon is always disabled). */
  disabled?: boolean;
};

/**
 * Figma `Tool toggle row` (02 `375:25310`): 44 high operator tool toggle. state on | off |
 * coming-soon (muted label, Coming soon chip, disabled off switch).
 */
function ToolToggleRow({
  className,
  label,
  icon = "globe",
  state = "on",
  onCheckedChange,
  disabled = false,
  ...props
}: ToolToggleRowProps) {
  const comingSoon = state === "coming-soon";
  const id = React.useId();
  return (
    <div
      data-slot="tool-toggle-row"
      data-state={state}
      className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 py-2", className)}
      {...props}
    >
      <Icon name={icon} size={20} className={comingSoon ? "text-muted-foreground" : "text-foreground"} />
      <label
        htmlFor={id}
        className={cn("min-w-0 flex-1 truncate type-body", comingSoon ? "text-muted-foreground" : "text-foreground")}
      >
        {label}
      </label>
      {comingSoon ? (
        <Chip asStatic size="sm">
          Coming soon
        </Chip>
      ) : null}
      <span className="inline-flex h-10 w-11 shrink-0 items-center px-1">
        <Switch
          id={id}
          checked={state === "on"}
          disabled={comingSoon || disabled}
          onCheckedChange={onCheckedChange}
        />
      </span>
    </div>
  );
}

export { operatorToolIcon, ToolToggleRow };
export type { ToolToggleRowProps, ToolToggleRowState };
