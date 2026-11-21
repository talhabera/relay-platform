"use client";

import { usePathname } from "next/navigation";

import { useCompany } from "@/components/shared/company-context";
import { AppHeader, CompanySwitcher, UserMenu } from "@/components/v2/shell";
import { signOutAction } from "@/lib/auth-actions";

import { resolveShellNav } from "./app-shell-nav";
import { NeedsYouBell } from "./needs-you-bell";

/** Settings entry in the user menu: the Agency companies list in the Settings shell (S47). */
const SETTINGS_HREF = "/settings/companies";
/** Read-only owner/member preview of the client portal (Figma 11 `11/live/preview`). */
const CLIENT_PORTAL_PREVIEW_HREF = "/client/live/preview";

type AppShellHeaderProps = {
  user: { name: string | null; image?: string | null };
};

/** v2 App header bound to the session, active company and page permissions (Figma 03 shell/*). */
export function AppShellHeader({ user }: AppShellHeaderProps) {
  const pathname = usePathname();
  const {
    companies,
    activeCompany,
    activeCompanyId,
    setActiveCompany,
    isLoading,
    isActiveCompanyOwner,
    hasPageAccess,
  } = useCompany();
  const nav = resolveShellNav({ isOwner: isActiveCompanyOwner, hasPageAccess, pathname });
  const roleLabel = isActiveCompanyOwner ? "Owner" : "Member";

  return (
    <AppHeader
      role={nav.role}
      active={nav.active}
      show={nav.show}
      className="sticky top-0 z-20 shrink-0"
      bell={activeCompany ? <NeedsYouBell /> : undefined}
      companySwitcher={
        <CompanySwitcher
          companies={companies}
          activeCompanyId={activeCompanyId}
          onSelect={setActiveCompany}
          loading={isLoading}
        />
      }
      userMenu={
        <UserMenu
          role={nav.role}
          user={user}
          meta={activeCompany ? `${roleLabel} · ${activeCompany.name}` : undefined}
          hrefs={{ settings: SETTINGS_HREF }}
          clientPortalHref={activeCompany ? CLIENT_PORTAL_PREVIEW_HREF : undefined}
          onSignOut={() => void signOutAction()}
        />
      }
    />
  );
}
