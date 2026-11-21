import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon } from "./icon";

type AgentChipProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** operator = versioned internal agent; customer = channel-facing agent. */
  kind: "operator" | "customer";
  name: string;
  /** Version label, e.g. "v1". Shown only with status live or draft. */
  version?: string;
  /** Figma `version=live|draft|none`. */
  status?: "live" | "draft" | "none";
};

/** Figma `Agent chip` (02 `355:646`): kind tile, name, version pill. 32 high, card fill, radius/full. */
function AgentChip({ className, kind, name, version, status = "none", ...props }: AgentChipProps) {
  const showVersion = status !== "none";
  return (
    <span
      data-slot="agent-chip"
      data-kind={kind}
      data-status={status}
      className={cn(
        "inline-flex h-8 w-fit max-w-full shrink-0 items-center gap-2 rounded-full border border-border bg-card p-1",
        !showVersion && "pr-3",
        className,
      )}
      {...props}
    >
      <span
        data-slot="agent-chip-tile"
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full",
          kind === "operator" ? "bg-primary-soft text-primary" : "bg-secondary text-foreground",
        )}
      >
        <Icon name={kind === "operator" ? "bot" : "message-circle"} size={14} />
      </span>
      <span className="truncate type-body-strong text-foreground">{name}</span>
      {showVersion ? (
        <span
          data-slot="agent-chip-version"
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 type-caption",
            status === "draft"
              ? "bg-status-draft text-status-draft-foreground"
              : "bg-status-live text-status-live-foreground",
          )}
        >
          {version ? <span>{version}</span> : null}
          <span>{status === "draft" ? "Draft" : "Live"}</span>
        </span>
      ) : null}
    </span>
  );
}

export { AgentChip };
export type { AgentChipProps };
