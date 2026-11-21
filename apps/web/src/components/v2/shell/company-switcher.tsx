"use client";

import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { initials } from "./initials";

type SwitcherCompany = { id: string; name: string };

type CompanySwitcherProps = {
  companies: readonly SwitcherCompany[];
  activeCompanyId?: string | null;
  onSelect?: (companyId: string) => void;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const triggerClass =
  "flex h-[42px] max-w-60 shrink-0 items-center gap-2 overflow-hidden rounded-full border border-border bg-card py-2 pr-3 pl-2 outline-none";

function CompanyAvatar({ name }: { name: string }) {
  return (
    <Avatar size="sm">
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Figma `Company switcher` (02 `9:95`): state closed | open | loading | single. Pill trigger
 * (24px initials avatar, body-strong name, chevron); open shows a 260px "Switch company" menu
 * with a check on the active row. single drops the chevron and the menu.
 */
function CompanySwitcher({
  companies,
  activeCompanyId,
  onSelect,
  loading = false,
  open: openProp,
  onOpenChange,
  className,
}: CompanySwitcherProps) {
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  if (loading) {
    return (
      <button
        type="button"
        disabled
        data-slot="company-switcher-trigger"
        data-state-name="loading"
        aria-label="Loading companies"
        className={cn(triggerClass, className)}
      >
        <Skeleton variant="avatar" />
        <Skeleton className="w-24" />
        <Icon name="chevron-down" size={16} className="text-muted-foreground" />
      </button>
    );
  }

  if (companies.length === 0) return null;

  const active = companies.find((c) => c.id === activeCompanyId) ?? companies[0];

  if (companies.length === 1) {
    return (
      <div data-slot="company-switcher-trigger" data-state-name="single" className={cn(triggerClass, className)}>
        <CompanyAvatar name={active.name} />
        <span className="truncate type-body-strong text-foreground">{active.name}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-slot="company-switcher-trigger"
        data-state-name={open ? "open" : "closed"}
        aria-label="Switch company"
        className={cn(
          triggerClass,
          "transition-[background-color,box-shadow] hover:bg-accent focus-visible:shadow-focus-ring",
          className,
        )}
      >
        <CompanyAvatar name={active.name} />
        <span className="truncate type-body-strong text-foreground">{active.name}</span>
        <Icon name="chevron-down" size={16} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" data-slot="company-switcher-menu" className="flex w-65 flex-col gap-1 p-1">
        <p className="p-2 type-label text-muted-foreground">Switch company</p>
        <div role="listbox" aria-label="Companies" className="flex max-h-75 flex-col gap-1 overflow-y-auto">
          {companies.map((company) => {
            const isActive = company.id === active.id;
            return (
              <button
                key={company.id}
                type="button"
                role="option"
                aria-selected={isActive}
                aria-current={isActive ? "true" : undefined}
                data-slot="company-switcher-row"
                onClick={() => {
                  onSelect?.(company.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-9 w-full shrink-0 items-center gap-2 rounded-md p-2 text-left type-body text-popover-foreground outline-none hover:bg-accent focus-visible:bg-accent",
                  isActive && "bg-accent",
                )}
              >
                <CompanyAvatar name={company.name} />
                <span className="min-w-0 flex-1 truncate">{company.name}</span>
                {isActive ? <Icon name="check" size={16} className="text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { CompanySwitcher };
export type { CompanySwitcherProps, SwitcherCompany };
