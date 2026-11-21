import * as React from "react";

import { cn } from "@/lib/utils";

import { StatusChip } from "../primitives/status-chip";

type VersionTicketProps = Omit<React.ComponentProps<"button">, "children" | "title"> & {
  /** "v1", "v2". */
  version: string;
  /** agent_versions.status: exactly one live version per operator agent. */
  status: "live" | "draft";
  /** "Deployed 14 Sep" / draft name. */
  title: string;
  /** Parent line (Figma `hasParent`), e.g. "Forked from v1 · 23 Sep". */
  note?: string;
  selected?: boolean;
};

/**
 * Figma `Version ticket` (02 `17:211`, restyled in v2/work): 200-wide selectable card with mono
 * version, Live/Draft Status chip, title and an optional parent note.
 */
function VersionTicket({ className, version, status, title, note, selected = false, ...props }: VersionTicketProps) {
  return (
    <button
      type="button"
      data-slot="version-ticket"
      data-status={status}
      aria-pressed={selected}
      className={cn(
        "flex w-50 max-w-full flex-col items-start gap-1 rounded-lg p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected ? "border-[1.5px] border-primary bg-primary-soft" : "border border-border bg-card hover:bg-accent",
        className,
      )}
      {...props}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="type-mono text-foreground">{version}</span>
        <StatusChip tone={status} />
      </span>
      <span className="w-full type-body-strong text-foreground">{title}</span>
      {note ? (
        <span data-slot="version-ticket-note" className="type-caption whitespace-nowrap text-muted-foreground">
          {note}
        </span>
      ) : null}
    </button>
  );
}

export { VersionTicket };
export type { VersionTicketProps };
