import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { CountBadge } from "../primitives/count-badge";
import { Icon } from "../primitives/icon";
import { iconButtonVariants } from "../primitives/icon-button";
import { NeedsYouRow, type NeedsYouRowData } from "./needs-you-row";

type NeedsYouListProps = Omit<React.ComponentProps<"section">, "children"> & {
  /** Rows in server order (impact tier, then oldest first). Not re-sorted here. */
  items: NeedsYouRowData[];
  /** Header count; defaults to items.length (counts match the visible items). */
  total?: number;
  /** Filter button target: the full view with KIND / WORKFLOW filters. */
  filterHref?: string;
};

/**
 * Figma 06 `06/entry-points/default` surface 2 "Operator · Needs you list" (`414:60556`):
 * card with "Needs you" + warning Count badge, "Ordered by impact on qualified leads",
 * a filter Icon button that opens the full list (06/needs-you/list), then Needs you rows.
 */
function NeedsYouList({ className, items, total, filterHref = "/needs-you", ...props }: NeedsYouListProps) {
  const empty = items.length === 0;
  const count = total ?? items.length;
  return (
    <section
      data-slot="needs-you-list"
      data-state={empty ? "empty" : "default"}
      aria-label="Needs you"
      className={cn("flex w-full flex-col rounded-2xl border border-border bg-card p-2 shadow-elevation-1", className)}
      {...props}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="type-h3 text-foreground">Needs you</h2>
            {!empty ? <CountBadge tone="warning" count={count} aria-label={`${count} open`} /> : null}
          </div>
          <p className="type-caption text-muted-foreground">Ordered by impact on qualified leads</p>
        </div>
        <Link
          href={filterHref}
          aria-label="Filter Needs you"
          className={iconButtonVariants({ variant: "ghost", size: "sm" })}
        >
          <Icon name="filter" size={16} />
        </Link>
      </header>
      {empty ? (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name="circle-check" size={20} />
          </span>
          <p className="type-body-strong text-foreground">You&apos;re all caught up</p>
          <p className="type-small text-muted-foreground">Nothing waits on you right now.</p>
        </div>
      ) : (
        <div data-slot="needs-you-list-rows" className="flex flex-col">
          {items.map(({ id, ...row }) => (
            <NeedsYouRow key={id} {...row} />
          ))}
        </div>
      )}
    </section>
  );
}

export { NeedsYouList };
export type { NeedsYouListProps };
