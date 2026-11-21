import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { CountBadge } from "../primitives/count-badge";
import { Icon } from "../primitives/icon";
import { NeedsYouRow, type NeedsYouRowData } from "./needs-you-row";

type NeedsYouPanelProps = Omit<React.ComponentProps<"section">, "children"> & {
  /** Rows in server order (impact tier, then oldest first). Not re-sorted here. */
  items: NeedsYouRowData[];
  /** Bell count; defaults to items.length. */
  total?: number;
  viewAllHref?: string;
  operatorHref?: string;
};

const linkClass =
  "inline-flex shrink-0 items-center gap-1 rounded-sm type-small text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Figma `Needs you panel` (02 `375:23840`): bell dropdown, 400 wide. Header with a warning
 * Count badge (hidden when empty), Needs you rows, footer "Ordered by impact on qualified leads".
 */
function NeedsYouPanel({
  className,
  items,
  total,
  viewAllHref = "/needs-you",
  operatorHref = "/operator",
  ...props
}: NeedsYouPanelProps) {
  const empty = items.length === 0;
  const badge = total ?? items.length;
  return (
    <section
      data-slot="needs-you-panel"
      data-state={empty ? "empty" : "default"}
      aria-label="Needs you"
      className={cn(
        "flex w-full max-w-100 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-elevation-2",
        className,
      )}
      {...props}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="type-body-strong text-foreground">Needs you</h2>
          {!empty ? <CountBadge tone="warning" count={badge} /> : null}
        </div>
        <Link href={viewAllHref} className={linkClass}>
          View all
        </Link>
      </header>
      {empty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name="circle-check" size={24} />
          </span>
          <p className="type-body-strong text-foreground">You&apos;re all caught up</p>
          <p className="max-w-75 type-small text-muted-foreground">
            Checkpoints, questions and failed runs show up here, ordered by impact on qualified leads.
          </p>
        </div>
      ) : (
        <div data-slot="needs-you-panel-list" className="flex flex-col">
          {items.map(({ id, ...row }) => (
            <NeedsYouRow key={id} {...row} />
          ))}
        </div>
      )}
      <footer className="flex items-center justify-between gap-2 px-5 py-3">
        <span className="type-caption text-muted-foreground">Ordered by impact on qualified leads</span>
        <Link href={operatorHref} className={linkClass}>
          Open Operator
          <Icon name="arrow-right" size={14} />
        </Link>
      </footer>
    </section>
  );
}

export { NeedsYouPanel };
export type { NeedsYouPanelProps };
