import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { IconButton } from "../primitives/icon-button";
import { StatusChip } from "../primitives/status-chip";
import { initials } from "../shell/initials";

type MemberRowStatus = "active" | "invited";

type MemberRowProps = Omit<React.ComponentProps<"div">, "children" | "role"> & {
  status?: MemberRowStatus;
  name: string;
  email: string;
  /** Role chip label (direct override in Figma), e.g. "Operator", "Client". */
  role: string;
  /** Active: "Active today, 14:32". Invited: "Invited 23 Sep, 09:10". */
  lastActive?: string;
  /** Replaces the ellipsis button, e.g. a DropdownMenu trigger. */
  actions?: React.ReactNode;
  onMenu?: () => void;
};

/**
 * Figma `Member row` (02 `385:5063`): Settings › Members list row. status active (success chip)
 * | invited (pending chip). Columns: member 260, role 120, status 120, time, actions.
 */
function MemberRow({ className, status = "active", name, email, role, lastActive, actions, onMenu, ...props }: MemberRowProps) {
  return (
    <div
      data-slot="member-row"
      data-status={status}
      className={cn("flex w-full items-center gap-4 border-b border-border px-4 py-3", className)}
      {...props}
    >
      <div className="flex w-65 shrink-0 items-center gap-3 overflow-hidden">
        <Avatar size="md">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate type-body-strong text-foreground">{name}</span>
          <span className="truncate type-caption text-muted-foreground">{email}</span>
        </div>
      </div>
      <div className="flex w-30 shrink-0 items-center overflow-hidden">
        <StatusChip tone="neutral" dot={false} data-slot="member-row-role">
          {role}
        </StatusChip>
      </div>
      <div className="flex w-30 shrink-0 items-center overflow-hidden">
        {status === "invited" ? <StatusChip tone="pending">Invited</StatusChip> : <StatusChip tone="success">Active</StatusChip>}
      </div>
      <span className="min-w-0 flex-1 type-small text-muted-foreground">{lastActive}</span>
      {actions ?? <IconButton icon="ellipsis" label={`Actions for ${name}`} size="sm" onClick={onMenu} />}
    </div>
  );
}

export { MemberRow };
export type { MemberRowProps, MemberRowStatus };
