import * as React from "react";
import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

import { AgentChip, type AgentChipProps } from "../primitives/agent-chip";
import { CountBadge } from "../primitives/count-badge";
import { Icon } from "../primitives/icon";
import { IconButton, iconButtonVariants } from "../primitives/icon-button";
import { StatusChip } from "../primitives/status-chip";
import { sessionStatusLabel, sessionStatusTone, type SessionStatus } from "./session-status";

type SessionCrumb = { label: string; href?: string };

type SessionHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: string;
  status: SessionStatus;
  /** Workflows / <workflow> / <stage>. The last crumb is the current page. */
  crumbs: SessionCrumb[];
  agent: AgentChipProps;
  /** Preformatted start time, e.g. "Started Fri 25 Sep, 11:32". */
  startedLabel?: string;
  /** Back target; omitted hides the back button. */
  backHref?: string;
  /** Overflow menu; defaults to a ghost ellipsis button. Pass null to hide it. */
  menu?: React.ReactNode;
  /**
   * Open checkpoints + questions on this session (`countSessionNeedsYou`). Shown as a
   * warning Count badge beside the status chip while status is needs-you (06 entry-points 4).
   */
  needsYouCount?: number;
};

/**
 * Figma `Session header` (02 `375:22789`): back, breadcrumb, title, Agent chip,
 * Status chip, start time, menu. status maps to the Status chip tone.
 */
function SessionHeader({
  className,
  title,
  status,
  crumbs,
  agent,
  startedLabel,
  backHref,
  menu,
  needsYouCount = 0,
  ...props
}: SessionHeaderProps) {
  const showCount = status === "needs-you" && needsYouCount > 0;
  return (
    <header
      data-slot="session-header"
      data-status={status}
      className={cn(
        "flex w-full min-w-0 items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-elevation-1",
        className,
      )}
      {...props}
    >
      {backHref ? (
        <Link href={backHref} aria-label="Back" className={iconButtonVariants({ variant: "outline", size: "md" })}>
          <Icon name="arrow-left" size={20} />
        </Link>
      ) : null}
      <div className="flex min-w-0 shrink flex-col gap-1">
        {crumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap py-1">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <React.Fragment key={`${c.label}-${i}`}>
                    <BreadcrumbItem>
                      {last ? (
                        <BreadcrumbPage>{c.label}</BreadcrumbPage>
                      ) : c.href ? (
                        <BreadcrumbLink asChild>
                          <Link href={c.href}>{c.label}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <span className="truncate">{c.label}</span>
                      )}
                    </BreadcrumbItem>
                    {last ? null : <BreadcrumbSeparator />}
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <h1 className="truncate type-h3 text-foreground">{title}</h1>
      </div>
      <AgentChip {...agent} />
      <StatusChip tone={sessionStatusTone[status]}>{sessionStatusLabel[status]}</StatusChip>
      {showCount ? (
        <CountBadge
          data-slot="session-header-needs-you-count"
          tone="warning"
          count={needsYouCount}
          aria-label={`${needsYouCount} waiting on you`}
        />
      ) : null}
      <div aria-hidden className="h-px min-w-0 flex-1" />
      {startedLabel ? (
        <span className="shrink-0 whitespace-nowrap type-caption text-muted-foreground">{startedLabel}</span>
      ) : null}
      {menu === undefined ? <IconButton icon="ellipsis" label="Session actions" variant="ghost" /> : menu}
    </header>
  );
}

export { SessionHeader };
export type { SessionCrumb, SessionHeaderProps };
