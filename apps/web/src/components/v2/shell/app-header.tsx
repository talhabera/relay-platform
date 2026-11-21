import * as React from "react";

import { cn } from "@/lib/utils";

import { IconButton } from "../primitives/icon-button";
import { BrandLockup } from "./brand";
import { NavPill, resolveNavItems, type NavKey, type ShellRole } from "./nav-pill";

type AppHeaderProps = Omit<React.ComponentProps<"header">, "children"> & {
  role: ShellRole;
  /** Active tab; `none` on Settings and restricted pages. */
  active?: NavKey | "none";
  /** Figma `show<Tab>` booleans (hide tabs a member was not granted). */
  show?: Partial<Record<NavKey, boolean>>;
  /** Override a tab's href (e.g. once Inbox moves off `/messaging`). */
  hrefs?: Partial<Record<NavKey, string>>;
  /** Company switcher slot, right of the Brand lockup. */
  companySwitcher?: React.ReactNode;
  /** User menu slot (avatar, name, chevron). */
  userMenu?: React.ReactNode;
  /** Bell slot; defaults to the ghost Icon button. */
  bell?: React.ReactNode;
  /** Unread dot on the default bell. */
  unread?: boolean;
};

/**
 * Figma `App header` (02 `375:24991`): 72px. Left Brand lockup + Company switcher, centre floating
 * pill nav, right bell + user menu. role member never shows Agents.
 */
function AppHeader({
  className,
  role,
  active = "none",
  show,
  hrefs,
  companySwitcher,
  userMenu,
  bell,
  unread = false,
  ...props
}: AppHeaderProps) {
  const items = resolveNavItems({ role, show });
  return (
    <header
      data-slot="app-header"
      data-role={role}
      className={cn("flex h-18 w-full items-center gap-4 bg-background px-6", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <BrandLockup />
        {companySwitcher}
      </div>
      <nav
        data-slot="app-header-nav"
        aria-label="Main"
        className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-nav p-1 shadow-elevation-2"
      >
        {items.map((item) => (
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

export { AppHeader };
export type { AppHeaderProps };
