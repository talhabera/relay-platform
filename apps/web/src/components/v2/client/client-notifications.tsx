import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

type ClientNotificationItem = {
  id: string;
  kind: "report_ready" | "handoff_request";
  title: string;
  detail: string;
  /** ISO timestamp. */
  at: string;
  /** Pre-formatted time in the company timezone. */
  when: string;
  href: string;
  unread: boolean;
};

const KIND_TILES: Record<ClientNotificationItem["kind"], { icon: IconName; tile: string }> = {
  report_ready: { icon: "file-text", tile: "bg-primary-soft text-primary" },
  handoff_request: { icon: "hand-helping", tile: "bg-status-needs-you text-status-needs-you-foreground" },
};

/** One bell row: kind tile, title + detail, time, unread dot. Links to the report or Live. */
function ClientNotificationRow({ item, className }: { item: ClientNotificationItem; className?: string }) {
  const spec = KIND_TILES[item.kind];
  return (
    <Link
      href={item.href}
      data-slot="client-notification-row"
      data-kind={item.kind}
      data-unread={item.unread ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent",
        className,
      )}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", spec.tile)}>
        <Icon name={spec.icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate type-body text-foreground">{item.title}</span>
        {item.detail ? <span className="truncate type-small text-muted-foreground">{item.detail}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <time dateTime={item.at} className="type-caption whitespace-nowrap text-muted-foreground">
          {item.when}
        </time>
        {item.unread ? (
          <span data-slot="client-notification-dot" aria-label="Unread" className="size-2 rounded-full bg-primary" />
        ) : null}
      </span>
    </Link>
  );
}

type ClientNotificationListProps = Omit<React.ComponentProps<"div">, "children"> & {
  items: readonly ClientNotificationItem[];
};

/** Bell list and the Notifications page list. Empty state names both event kinds. */
function ClientNotificationList({ items, className, ...props }: ClientNotificationListProps) {
  if (items.length === 0) {
    return (
      <div
        data-slot="client-notification-list"
        data-state="empty"
        className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}
        {...props}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon name="bell" size={24} />
        </span>
        <p className="type-body-strong text-foreground">No notifications yet</p>
        <p className="max-w-75 type-small text-muted-foreground">
          New reports and handoff requests sent to you show up here.
        </p>
      </div>
    );
  }
  return (
    <div data-slot="client-notification-list" className={cn("flex flex-col", className)} {...props}>
      {items.map((item) => (
        <ClientNotificationRow key={item.id} item={item} />
      ))}
    </div>
  );
}

const linkClass =
  "inline-flex shrink-0 items-center gap-1 rounded-sm type-small text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

type ClientNotificationsPanelProps = Omit<React.ComponentProps<"section">, "children"> & {
  items: readonly ClientNotificationItem[];
  /** Notifications page (settings + full list). */
  settingsHref?: string;
};

/** Portal bell dropdown, same frame as the Needs you panel (400 wide). */
function ClientNotificationsPanel({
  items,
  settingsHref = "/client/profile/notifications",
  className,
  ...props
}: ClientNotificationsPanelProps) {
  return (
    <section
      data-slot="client-notifications-panel"
      aria-label="Notifications"
      className={cn(
        "flex w-full max-w-100 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-elevation-2",
        className,
      )}
      {...props}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h2 className="type-body-strong text-foreground">Notifications</h2>
        <Link href={settingsHref} className={linkClass}>
          Manage
        </Link>
      </header>
      <ClientNotificationList items={items} className="max-h-100 overflow-y-auto" />
    </section>
  );
}

export { ClientNotificationList, ClientNotificationRow, ClientNotificationsPanel };
export type { ClientNotificationItem, ClientNotificationListProps, ClientNotificationsPanelProps };
