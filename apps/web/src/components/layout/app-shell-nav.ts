import type { NavKey, ShellRole } from "@/components/v2/shell/nav-pill";
import type { PagePermissionKey } from "@/db/schema";

/** Page permission key gating each App header tab. Home is never gated. */
const TAB_PAGE: Record<Exclude<NavKey, "home">, PagePermissionKey> = {
  operator: "operator",
  inbox: "messaging",
  analytics: "analytics",
  agents: "agents",
};

const TAB_PREFIX: [NavKey, string][] = [
  ["home", "/home"],
  ["operator", "/operator"],
  // Needs you (06/needs-you/list) sits under Operator.
  ["operator", "/needs-you"],
  ["inbox", "/messaging"],
  ["analytics", "/analytics"],
  ["agents", "/agents"],
];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The tab that owns `pathname`; `none` on Settings, Companies and other routes. */
export function activeNavKey(pathname: string): NavKey | "none" {
  return TAB_PREFIX.find(([, prefix]) => matches(pathname, prefix))?.[0] ?? "none";
}

export type ShellNav = {
  role: ShellRole;
  show: Partial<Record<NavKey, boolean>>;
  active: NavKey | "none";
};

/**
 * App header state for the active company. Members see only granted tabs (Agents never, see
 * `resolveNavItems`); an ungranted route renders page-restricted with no active tab.
 */
export function resolveShellNav({
  isOwner,
  hasPageAccess,
  pathname,
}: {
  isOwner: boolean;
  hasPageAccess: (page: PagePermissionKey) => boolean;
  pathname: string;
}): ShellNav {
  const show: Partial<Record<NavKey, boolean>> = {};
  for (const [tab, page] of Object.entries(TAB_PAGE) as [NavKey, PagePermissionKey][]) {
    show[tab] = isOwner || hasPageAccess(page);
  }
  const active = activeNavKey(pathname);
  return {
    role: isOwner ? "owner" : "member",
    show,
    active: active === "none" || show[active] !== false ? active : "none",
  };
}
