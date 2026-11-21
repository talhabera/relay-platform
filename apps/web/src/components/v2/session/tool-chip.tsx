import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

type ToolChipState = "running" | "done" | "failed";

const stateIcon: Record<ToolChipState, { name: IconName; className: string }> = {
  running: { name: "loader-circle", className: "animate-spin text-primary" },
  done: { name: "circle-check", className: "text-success" },
  failed: { name: "circle-x", className: "text-destructive" },
};

const stateDetail: Record<ToolChipState, { text: string; className: string }> = {
  running: { text: "Running…", className: "text-primary" },
  done: { text: "Done", className: "text-muted-foreground" },
  failed: { text: "Failed", className: "text-destructive" },
};

type ToolChipProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Tool call name, e.g. "Edit email step 1". */
  label: string;
  state?: ToolChipState;
  /** Overrides the per-state detail text ("Running…", "Done", "Failed"). */
  detail?: string;
};

/**
 * Figma `Tool chip` (02 `374:1179`): tool call under an agent message.
 * running (spinner, teal), done (check), failed (x, destructive border).
 */
function ToolChip({ className, label, state = "done", detail, ...props }: ToolChipProps) {
  const icon = stateIcon[state];
  const d = stateDetail[state];
  return (
    <span
      data-slot="tool-chip"
      data-state={state}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center gap-2 rounded-md border bg-card py-1 pr-3 pl-2",
        state === "failed" ? "border-destructive" : "border-border",
        className,
      )}
      {...props}
    >
      <Icon name={icon.name} size={16} className={icon.className} />
      <span className="truncate type-small text-foreground">{label}</span>
      <span className={cn("shrink-0 whitespace-nowrap type-caption", d.className)}>{detail ?? d.text}</span>
    </span>
  );
}

export { ToolChip };
export type { ToolChipProps, ToolChipState };
