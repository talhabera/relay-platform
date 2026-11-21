import Link from "next/link";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

type NavKey = "home" | "operator" | "inbox" | "analytics" | "agents";

type NavItem = { key: NavKey; label: string; icon: IconName; href: string };

/** App header tabs in Figma order (03 `03/shell/*`). */
const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", label: "Home", icon: "house", href: "/home" },
  { key: "operator", label: "Operator", icon: "workflow", href: "/operator" },
  { key: "inbox", label: "Inbox", icon: "inbox", href: "/messaging" },
  { key: "analytics", label: "Analytics", icon: "chart-no-axes-column", href: "/analytics" },
  { key: "agents", label: "Agents", icon: "bot", href: "/agents" },
];

type ShellRole = "owner" | "member";

type ResolveNavOptions = {
  role: ShellRole;
  /** Figma `show<Tab>` booleans: false hides a tab the member was not granted. */
  show?: Partial<Record<NavKey, boolean>>;
};

/** Visible tabs: members never see Agents; `show[key] === false` hides a tab. */
function resolveNavItems({ role, show = {} }: ResolveNavOptions): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.key === "agents" && role !== "owner") return false;
    return show[item.key] !== false;
  });
}

type NavPillProps = Omit<React.ComponentProps<typeof Link>, "children"> & {
  icon: IconName;
  label: string;
  active?: boolean;
};

/**
 * Figma `Nav pill` (02 `375:22384`): state default | hover | active. Hover is CSS; active is a
 * filled pill with a 24x3 teal underline glow.
 */
function NavPill({ className, icon, label, active = false, ...props }: NavPillProps) {
  return (
    <Link
      data-slot="nav-pill"
      data-state={active ? "active" : "default"}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav-pill relative inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 type-body whitespace-nowrap outline-none transition-[color,background-color,box-shadow] focus-visible:shadow-focus-ring",
        active
          ? "bg-nav-active text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        className,
      )}
      {...props}
    >
      <Icon
        name={icon}
        size={16}
        className={active ? "text-primary" : "text-muted-foreground group-hover/nav-pill:text-foreground"}
      />
      {label}
      {active ? (
        <span
          data-slot="nav-pill-underline"
          aria-hidden
          className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-primary shadow-glow-primary"
        />
      ) : null}
    </Link>
  );
}

export { NAV_ITEMS, NavPill, resolveNavItems };
export type { NavItem, NavKey, NavPillProps, ResolveNavOptions, ShellRole };
