import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { StatusChip } from "../primitives/status-chip";
import { initials } from "../shell/initials";

/**
 * Matrix tab columns. `home` is always granted (Home replaces Panel Chat); the rest map to
 * `PAGE_PERMISSION_KEYS` (`messaging` is labelled Inbox). No `chat` or `approve` key: approve
 * rights are the per-agent `canApprove` switch.
 */
const ACCESS_MATRIX_COLUMNS = [
  { key: "home", label: "Home", icon: "house" },
  { key: "operator", label: "Operator", icon: "workflow" },
  { key: "messaging", label: "Inbox", icon: "inbox" },
  { key: "analytics", label: "Analytics", icon: "chart-no-axes-column" },
  { key: "agents", label: "Agents", icon: "bot" },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

type AccessMatrixKey = (typeof ACCESS_MATRIX_COLUMNS)[number]["key"];

type AccessMatrixRowProps = Omit<React.ComponentProps<"div">, "children" | "role"> &
  (
    | { variant: "header" }
    | {
        /** owner: every tab checked, approve on, nothing editable. member: per-tab Checkbox. */
        variant: "owner" | "member";
        name: string;
        email: string;
        /** Role chip label, e.g. "Owner", "Operator". */
        role: string;
        /** Member only: granted tabs. `home` is always on. */
        access?: Partial<Record<AccessMatrixKey, boolean>>;
        /** Member only: tabs shown disabled with a lock. Default `agents` (members never get Agents). */
        lockedKeys?: readonly AccessMatrixKey[];
        onAccessChange?: (key: AccessMatrixKey, granted: boolean) => void;
        /** Member only: "Approve checkpoints" switch. */
        canApprove?: boolean;
        onApproveChange?: (canApprove: boolean) => void;
        /**
         * Member only: the approve switch mirrors rights granted elsewhere (per agent). Renders
         * a disabled switch (not focusable, not toggleable) at full opacity.
         */
        approveReadOnly?: boolean;
        /** Disables every control (e.g. viewer is not the owner). */
        readOnly?: boolean;
      }
  );

const cellClass = "flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden";

/**
 * Figma `Access matrix row` (02 `384:28414`): Settings › Access & roles row. variant header (tab
 * icons + labels on muted) | owner (all checked, approve on) | member (per-tab Checkbox, Agents
 * disabled + lock, approve Switch).
 */
function AccessMatrixRow(props: AccessMatrixRowProps) {
  if (props.variant === "header") {
    const { className, variant, ...rest } = props;
    return (
      <div
        data-slot="access-matrix-row"
        data-variant={variant}
        role="row"
        className={cn("flex w-full items-center border-b border-border bg-muted px-4 py-2", className)}
        {...rest}
      >
        <span role="columnheader" className="w-66 shrink-0 type-label text-muted-foreground">
          Member
        </span>
        {ACCESS_MATRIX_COLUMNS.map((col) => (
          <span key={col.key} role="columnheader" className={cn(cellClass, "type-label text-muted-foreground")}>
            <Icon name={col.icon} size={14} />
            {col.label}
          </span>
        ))}
        <span role="columnheader" className="flex w-38 shrink-0 justify-center type-label text-muted-foreground">
          Approve checkpoints
        </span>
      </div>
    );
  }

  const {
    className,
    variant,
    name,
    email,
    role,
    access = {},
    lockedKeys = ["agents"],
    onAccessChange,
    canApprove = false,
    onApproveChange,
    approveReadOnly = false,
    readOnly = false,
    ...rest
  } = props;
  const owner = variant === "owner";
  const approveFixed = owner || approveReadOnly;

  return (
    <div
      data-slot="access-matrix-row"
      data-variant={variant}
      role="row"
      className={cn("flex w-full items-center border-b border-border px-4 py-3", className)}
      {...rest}
    >
      <div role="rowheader" className="flex w-66 shrink-0 items-center gap-3 overflow-hidden">
        <Avatar size="md">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="truncate type-body-strong text-foreground">{name}</span>
            <StatusChip tone="neutral" dot={false}>
              {role}
            </StatusChip>
          </div>
          <span className="truncate type-caption text-muted-foreground">{email}</span>
        </div>
      </div>
      {ACCESS_MATRIX_COLUMNS.map((col) => {
        const locked = !owner && lockedKeys.includes(col.key);
        const fixed = owner || col.key === "home";
        const checked = fixed || (!locked && Boolean(access[col.key]));
        return (
          <div key={col.key} role="cell" className={cellClass}>
            <span className="flex h-10 items-center px-1">
              <Checkbox
                aria-label={`${col.label} access for ${name}`}
                checked={checked}
                disabled={fixed || locked || readOnly}
                onCheckedChange={(v) => onAccessChange?.(col.key, v === true)}
                className={fixed ? "disabled:opacity-100" : undefined}
              />
            </span>
            {locked ? <Icon name="lock" size={14} className="text-muted-foreground" data-slot="access-matrix-lock" /> : null}
          </div>
        );
      })}
      <div role="cell" className="flex w-38 shrink-0 items-center justify-center">
        <span className="flex h-10 items-center px-1">
          <Switch
            aria-label={`Approve checkpoints for ${name}`}
            checked={owner || canApprove}
            disabled={approveFixed || readOnly}
            onCheckedChange={(v) => onApproveChange?.(v)}
            className={approveFixed ? "disabled:cursor-default disabled:opacity-100" : undefined}
          />
        </span>
      </div>
    </div>
  );
}

export { ACCESS_MATRIX_COLUMNS, AccessMatrixRow };
export type { AccessMatrixKey, AccessMatrixRowProps };
