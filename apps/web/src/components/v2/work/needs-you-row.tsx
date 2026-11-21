import * as React from "react";
import Link from "next/link";

import type { NeedsYouItem } from "@/lib/operator/needs-you";
import { cn } from "@/lib/utils";

import { Chip } from "../primitives/chip";
import { Icon, type IconName } from "../primitives/icon";

type NeedsYouKind = "checkpoint" | "question" | "failed-run" | "brief";

/** NeedsYouItem.type (S04 aggregation) -> Figma `kind`. */
function needsYouKind(type: NeedsYouItem["type"]): NeedsYouKind {
  if (type === "agent_question") return "question";
  if (type === "failed_run") return "failed-run";
  if (type === "brief") return "brief";
  return "checkpoint";
}

const kindStyle: Record<NeedsYouKind, { label: string; icon: IconName; tile: string; fg: string; open: string }> = {
  checkpoint: { label: "Checkpoint", icon: "flag", tile: "bg-primary-soft", fg: "text-primary", open: "Open session" },
  question: {
    label: "Question",
    icon: "message-circle",
    tile: "bg-status-needs-you",
    fg: "text-status-needs-you-foreground",
    open: "Open session",
  },
  "failed-run": {
    label: "Failed run",
    icon: "triangle-alert",
    tile: "bg-status-rejected",
    fg: "text-status-rejected-foreground",
    open: "Open session",
  },
  brief: { label: "Brief", icon: "list-checks", tile: "bg-primary-soft", fg: "text-primary", open: "Open brief" },
};

type NeedsYouRowData = {
  id: string;
  kind: NeedsYouKind;
  title: string;
  /** Workflow tag (nested Chip label), e.g. "Lead engine". */
  workflow?: string;
  /** What the item holds up, e.g. "44 qualified leads wait for outreach". */
  impact?: string;
  agent: string;
  /** Pre-formatted relative age, e.g. "7m ago". */
  age: string;
  href: string;
};

type NeedsYouRowProps = Omit<React.ComponentProps<"article">, "id" | "children"> & Omit<NeedsYouRowData, "id"> & {
  id?: string;
  /** Selected in a list with a detail pane (06/needs-you/list). */
  selected?: boolean;
  /** Makes the title a link (e.g. select the row in the list page). */
  titleHref?: string;
};

/**
 * Figma `Needs you row` (02 `375:22849`): one item in Needs you (bell panel, Operator list,
 * Home tile). 32px kind tile, kind label + workflow chip + age, title, impact line, agent and
 * an "Open session" link.
 */
function NeedsYouRow({
  className,
  kind,
  title,
  workflow,
  impact,
  agent,
  age,
  href,
  selected = false,
  titleHref,
  ...props
}: NeedsYouRowProps) {
  const k = kindStyle[kind];
  return (
    <article
      data-slot="needs-you-row"
      data-kind={kind}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-4 py-3",
        selected && "rounded-lg border-transparent bg-primary-soft",
        className,
      )}
      {...props}
    >
      <span
        data-slot="needs-you-row-tile"
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", k.tile, k.fg)}
      >
        <Icon name={k.icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span data-slot="needs-you-row-kind" className={cn("shrink-0 type-label", k.fg)}>
              {k.label}
            </span>
            {workflow ? (
              <Chip asStatic className="min-w-0">
                <span className="truncate">{workflow}</span>
              </Chip>
            ) : null}
          </div>
          <span className="shrink-0 type-caption text-muted-foreground">{age}</span>
        </div>
        {titleHref ? (
          <Link
            href={titleHref}
            scroll={false}
            className="rounded-sm type-body-strong text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {title}
          </Link>
        ) : (
          <p className="type-body-strong text-foreground">{title}</p>
        )}
        {impact ? (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Icon name="target" size={14} />
            <span className="min-w-0 flex-1 type-caption">{impact}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate type-small text-muted-foreground">{agent}</span>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm type-small text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {k.open}
            <Icon name="arrow-right" size={14} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export { NeedsYouRow, needsYouKind };
export type { NeedsYouKind, NeedsYouRowData, NeedsYouRowProps };
