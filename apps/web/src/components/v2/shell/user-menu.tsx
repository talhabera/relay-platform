"use client";

import * as React from "react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { initials } from "./initials";
import type { ShellRole } from "./nav-pill";

type UserMenuItemProps = Omit<React.ComponentProps<typeof DropdownMenuItem>, "children"> & {
  icon: IconName;
  label: string;
  /** Renders the row as a link. */
  href?: string;
};

/** Figma `User menu item` (02 `375:23842`): 36px row, 16px icon, 12px gap, type/body. */
function UserMenuItem({ className, icon, label, href, ...props }: UserMenuItemProps) {
  const content = (
    <>
      <Icon name={icon} size={16} className="text-popover-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );
  return (
    <DropdownMenuItem
      data-slot="user-menu-item"
      asChild={href ? true : undefined}
      className={cn("h-9 gap-3 px-2 text-popover-foreground", className)}
      {...props}
    >
      {href ? <Link href={href}>{content}</Link> : content}
    </DropdownMenuItem>
  );
}

type UserMenuHrefs = { profile: string; preferences: string; settings: string };

const USER_MENU_HREFS: UserMenuHrefs = {
  profile: "/settings/profile",
  preferences: "/settings/preferences",
  settings: "/settings/companies",
};

type UserMenuProps = {
  role: ShellRole;
  user: { name: string | null; image?: string | null };
  /** Identity sub-line, e.g. "Owner · Acme GmbH". */
  meta?: string;
  hrefs?: Partial<UserMenuHrefs>;
  /** Owner-only "View client portal" entry (opens the read-only live preview). */
  clientPortalHref?: string;
  onSignOut?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * Figma `User menu` (02 `375:24037`) behind the App header user trigger. role owner: Profile,
 * Preferences, Settings, Sign out. role member: no Settings. `clientPortalHref` adds the
 * View client portal item after Settings (03 `695:88241`).
 */
function UserMenu({
  role,
  user,
  meta,
  hrefs,
  clientPortalHref,
  onSignOut,
  open,
  onOpenChange,
  className,
}: UserMenuProps) {
  const links = { ...USER_MENU_HREFS, ...hrefs };
  const name = user.name ?? "";
  const avatar = (ringed: boolean) => (
    <Avatar size="md" className={ringed ? "border-[1.5px] border-primary" : undefined}>
      {user.image ? <AvatarImage src={user.image} alt="" /> : null}
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-slot="user-menu-trigger"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-full p-1 outline-none transition-[background-color,box-shadow] hover:bg-accent focus-visible:shadow-focus-ring data-[state=open]:bg-accent",
          className,
        )}
      >
        {avatar(true)}
        <span className="truncate type-body-strong text-foreground">{name}</span>
        <Icon name="chevron-down" size={16} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-slot="user-menu-content" align="end" className="w-65">
        <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal">
          {avatar(false)}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body-strong text-popover-foreground">{name}</span>
            {meta ? <span className="truncate type-caption text-muted-foreground">{meta}</span> : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-0" />
        <UserMenuItem icon="user" label="Profile" href={links.profile} />
        <UserMenuItem icon="sun" label="Preferences" href={links.preferences} />
        {role === "owner" ? <UserMenuItem icon="settings" label="Settings" href={links.settings} /> : null}
        {clientPortalHref ? <UserMenuItem icon="eye" label="View client portal" href={clientPortalHref} /> : null}
        <DropdownMenuSeparator className="mx-0" />
        <UserMenuItem icon="log-out" label="Sign out" onSelect={onSignOut} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { USER_MENU_HREFS, UserMenu, UserMenuItem };
export type { UserMenuHrefs, UserMenuItemProps, UserMenuProps };
