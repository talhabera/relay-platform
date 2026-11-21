import * as React from "react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { AgentChip, type AgentChipProps } from "../primitives/agent-chip";
import { CountBadge } from "../primitives/count-badge";
import { Icon } from "../primitives/icon";
import { StatusChip } from "../primitives/status-chip";
import { sessionStatusLabel, sessionStatusTone, type SessionStatus } from "./session-status";

type SessionStartedBy =
  | { kind: "person"; name: string; initials: string }
  | { kind: "schedule"; name: string };

type SessionRowProps = Omit<React.ComponentProps<typeof Link>, "children" | "title"> & {
  status: SessionStatus;
  title: string;
  /** e.g. "Lead engine · Qualify". */
  workflow?: string;
  agent: AgentChipProps;
  startedBy: SessionStartedBy;
  /** Preformatted, e.g. "Mon 21 Sep, 06:00". */
  started: string;
  /** Preformatted, e.g. "38 min ago". */
  lastActivity: string;
  /** Open checkpoints. */
  checkpoints: number;
  selected?: boolean;
};

/**
 * Figma `Session row` (02 `520:73566`): Operator sessions list row. Columns status,
 * session + workflow, agent, started by, started, last activity, checkpoints, chevron.
 * Hover is CSS; selected = primary-soft. Column widths match the Sessions table head.
 */
function SessionRow({
  className,
  status,
  title,
  workflow,
  agent,
  startedBy,
  started,
  lastActivity,
  checkpoints,
  selected = false,
  ...props
}: SessionRowProps) {
  return (
    <Link
      data-slot="session-row"
      data-status={status}
      aria-current={selected ? true : undefined}
      className={cn(
        "flex h-[54px] w-full min-w-0 items-center gap-3 border-b border-border px-4 py-2 outline-none transition-colors focus-visible:shadow-focus-ring",
        selected ? "bg-primary-soft" : "hover:bg-muted",
        className,
      )}
      {...props}
    >
      <span className="flex w-[104px] shrink-0 items-center overflow-hidden">
        <StatusChip tone={sessionStatusTone[status]}>{sessionStatusLabel[status]}</StatusChip>
      </span>
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="truncate type-body-strong text-foreground">{title}</span>
        {workflow ? <span className="truncate type-small text-muted-foreground">{workflow}</span> : null}
      </span>
      <span className="flex w-[252px] shrink-0 items-center overflow-hidden">
        <AgentChip {...agent} />
      </span>
      <span className="flex w-[176px] shrink-0 items-center gap-2 overflow-hidden">
        {startedBy.kind === "person" ? (
          <Avatar size="sm">
            <AvatarFallback>{startedBy.initials}</AvatarFallback>
          </Avatar>
        ) : (
          <Icon name="calendar-clock" size={16} className="text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate type-small text-foreground">{startedBy.name}</span>
      </span>
      <span className="w-[124px] shrink-0 truncate type-small text-foreground">{started}</span>
      <span className="w-[124px] shrink-0 truncate type-small text-muted-foreground">{lastActivity}</span>
      <span className="flex w-[88px] shrink-0 items-center">
        <CountBadge count={checkpoints} aria-label={`${checkpoints} open checkpoints`} />
      </span>
      <Icon name="chevron-right" size={16} className="text-muted-foreground" />
    </Link>
  );
}

export { SessionRow };
export type { SessionRowProps, SessionStartedBy };
