"use client";

import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { IconButton } from "../primitives/icon-button";
import { ClientNotificationsPanel, type ClientNotificationItem } from "./client-notifications";

type ClientBellProps = {
  items: readonly ClientNotificationItem[];
  /** Server-computed: anything newer than the viewer's last bell open. */
  unread: boolean;
  /** Called once each time the panel opens (marks the feed seen). */
  onOpen?: () => void | Promise<void>;
  settingsHref?: string;
};

export function clientBellLabel(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications: ${unreadCount} new` : "Notifications";
}

/**
 * Client header bell (spec client-role-and-portal, decision 8): report ready and handoff
 * requests addressed to the viewer. The dot clears when the panel opens.
 */
function ClientBell({ items, unread, onOpen, settingsHref }: ClientBellProps) {
  const [open, setOpen] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);
  const dot = unread && !cleared;
  const unreadCount = cleared ? 0 : items.filter((item) => item.unread).length;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && dot) {
      setCleared(true);
      void onOpen?.();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton icon="bell" label={clientBellLabel(unreadCount)} dot={dot} data-slot="client-bell" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-100 max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <ClientNotificationsPanel items={items} settingsHref={settingsHref} />
      </PopoverContent>
    </Popover>
  );
}

export { ClientBell };
export type { ClientBellProps };
