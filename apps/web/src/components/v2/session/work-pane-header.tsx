import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

type WorkPaneHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: string;
  /** e.g. "4 steps · 44 leads · edited 2 min ago". */
  meta?: string;
  /** Glyph in the icon tile (Figma `icon` swap). */
  icon?: IconName;
  /** Per-workflow actions (outline Buttons + overflow). Omit for read-only sessions. */
  actions?: React.ReactNode;
};

/** Figma `Work pane header` (02 `378:25444`): icon tile, title, meta, per-workflow actions. */
function WorkPaneHeader({ className, title, meta, icon = "mail", actions, ...props }: WorkPaneHeaderProps) {
  return (
    <div
      data-slot="work-pane-header"
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-t-lg border-b border-border bg-card px-6 py-3",
        className,
      )}
      {...props}
    >
      <span
        data-slot="work-pane-icon"
        className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary-soft text-primary"
      >
        <Icon name={icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="truncate type-h3 text-foreground">{title}</h2>
        {meta ? <p className="truncate type-small text-muted-foreground">{meta}</p> : null}
      </div>
      <div aria-hidden className="h-px min-w-0 flex-1" />
      {actions ? (
        <div data-slot="work-pane-actions" className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export { WorkPaneHeader };
export type { WorkPaneHeaderProps };
