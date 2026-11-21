/** Settings shell navigation (Figma 08c `500:68865`): Company · {active}, Agency, You. */

export type SettingsNavIcon =
  | "shield"
  | "users"
  | "plug"
  | "package"
  | "building"
  | "user"
  | "settings";

export type SettingsNavItem = {
  title: string;
  href: string;
  icon: SettingsNavIcon;
  /** False until the page ships. Rendered disabled. */
  available: boolean;
};

export type SettingsNavSection = {
  label: string;
  items: SettingsNavItem[];
};

/** Where `/settings` lands: Profile is the one page every signed-in user has. */
export const SETTINGS_INDEX_HREF = "/settings/profile";

export function settingsNavSections(companyName: string | null): SettingsNavSection[] {
  return [
    {
      label: companyName ? `Company · ${companyName}` : "Company",
      items: [
        { title: "Access & roles", href: "/settings/access", icon: "shield", available: true },
        { title: "Members", href: "/settings/members", icon: "users", available: true },
        { title: "Connectors", href: "/settings/connectors", icon: "plug", available: true },
        { title: "Packages", href: "/settings/packages", icon: "package", available: true },
      ],
    },
    {
      label: "Agency",
      items: [
        { title: "Companies", href: "/settings/companies", icon: "building", available: true },
      ],
    },
    {
      label: "You",
      items: [
        { title: "Profile", href: "/settings/profile", icon: "user", available: true },
        { title: "Preferences", href: "/settings/preferences", icon: "settings", available: true },
      ],
    },
  ];
}

const ALL_HREFS = settingsNavSections(null).flatMap((s) => s.items.map((i) => i.href));

/** The nav item that owns `pathname` (`/settings/companies/[id]` -> Companies), or null. */
export function activeSettingsHref(pathname: string): string | null {
  return (
    ALL_HREFS.find((href) => pathname === href || pathname.startsWith(`${href}/`)) ?? null
  );
}
