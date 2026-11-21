"use client";

import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { initials } from "../shell/initials";
import { UserMenuItem } from "../shell/user-menu";

type ClientUserMenuHrefs = { profile: string; notifications: string };

const CLIENT_USER_MENU_HREFS: ClientUserMenuHrefs = {
  profile: "/client/profile",
  notifications: "/client/profile/notifications",
};

type ClientUserMenuProps = {
  user: { name: string | null; image?: string | null };
  /** Identity sub-line, e.g. "Client · Acme GmbH". */
  meta?: string;
  hrefs?: Partial<ClientUserMenuHrefs>;
  /** Called with no arguments (safe to pass a server action). */
  onSignOut?: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * Client user menu (spec client-role-and-portal, decision 4): Profile, Notifications, Sign out.
 * No Settings and no Preferences. Same trigger and panel as the App header User menu.
 */
function ClientUserMenu({ user, meta, hrefs, onSignOut, open, onOpenChange, className }: ClientUserMenuProps) {
  const links = { ...CLIENT_USER_MENU_HREFS, ...hrefs };
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
        data-slot="client-user-menu-trigger"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-full p-1 outline-none transition-[background-color,box-shadow] hover:bg-accent focus-visible:shadow-focus-ring data-[state=open]:bg-accent",
          className,
        )}
      >
        {avatar(true)}
        <span className="truncate type-body-strong text-foreground">{name}</span>
        <Icon name="chevron-down" size={16} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-slot="client-user-menu-content" align="end" className="w-65">
        <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal">
          {avatar(false)}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body-strong text-popover-foreground">{name}</span>
            {meta ? <span className="truncate type-caption text-muted-foreground">{meta}</span> : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-0" />
        <UserMenuItem icon="user" label="Profile" href={links.profile} />
        <UserMenuItem icon="bell" label="Notifications" href={links.notifications} />
        <DropdownMenuSeparator className="mx-0" />
        <UserMenuItem icon="log-out" label="Sign out" onSelect={() => void onSignOut?.()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { CLIENT_USER_MENU_HREFS, ClientUserMenu };
export type { ClientUserMenuHrefs, ClientUserMenuProps };
