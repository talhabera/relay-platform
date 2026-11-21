import * as React from "react";

import { cn } from "@/lib/utils";

import { IconButton } from "../primitives/icon-button";
import type { IconName } from "../primitives/icon";
import { BrandLockup } from "../shell/brand";
import { CompanySwitcher } from "../shell/company-switcher";
import { NavPill } from "../shell/nav-pill";

type ClientTab = "reports" | "live";

type ClientNavItem = { key: ClientTab; label: string; icon: IconName; href: string };

/** Client portal tabs (spec: client role and portal, decision 3). There is no client Inbox. */
const CLIENT_NAV_ITEMS: readonly ClientNavItem[] = [
  { key: "reports", label: "Reports", icon: "file-text", href: "/client/reports" },
  { key: "live", label: "Live", icon: "activity", href: "/client/live" },
];

type ClientHeaderProps = Omit<React.ComponentProps<"header">, "children"> & {
  /** Figma `active=reports|live`; null on Profile / Notifications (no tab lit). */
  active: ClientTab | null;
  /** The client's single company (static pill, Company switcher `state=single`). */
  company: { id: string; name: string };
  /** Override a tab's href (e.g. the owner's read-only preview under another prefix). */
  hrefs?: Partial<Record<ClientTab, string>>;
  /** Client user menu slot (Profile, Notifications, Sign out; no Settings). */
  userMenu?: React.ReactNode;
  /** Bell slot; defaults to the ghost Icon button. */
  bell?: React.ReactNode;
  /** Unread dot on the default bell. */
  unread?: boolean;
  /** Brand lockup target; defaults to Reports. */
  homeHref?: string;
};

/**
 * Figma `Client header` (02 `454:61663`): same 72px height and padding as App header. Left Brand
 * lockup + static company pill, centre floating Reports · Live nav, right bell + client user menu.
 */
function ClientHeader({
  className,
  active,
  company,
  hrefs,
  userMenu,
  bell,
  unread = false,
  homeHref,
  ...props
}: ClientHeaderProps) {
  return (
    <header
      data-slot="client-header"
      data-active={active ?? undefined}
      className={cn("flex h-18 w-full items-center gap-4 bg-background px-6", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <BrandLockup href={homeHref ?? hrefs?.reports ?? CLIENT_NAV_ITEMS[0].href} />
        <CompanySwitcher companies={[company]} activeCompanyId={company.id} />
      </div>
      <nav
        data-slot="client-header-nav"
        aria-label="Client portal"
        className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-nav p-1 shadow-elevation-2"
      >
        {CLIENT_NAV_ITEMS.map((item) => (
          <NavPill
            key={item.key}
            href={hrefs?.[item.key] ?? item.href}
            icon={item.icon}
            label={item.label}
            active={item.key === active}
          />
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        {bell ?? <IconButton icon="bell" label="Notifications" dot={unread} />}
        {userMenu}
      </div>
    </header>
  );
}

export { CLIENT_NAV_ITEMS, ClientHeader };
export type { ClientHeaderProps, ClientNavItem, ClientTab };
