import { createElement as h, Fragment, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix portals render nothing on the server; pass children through so open menus
// render into static markup.
vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  const Passthrough = ({ children }: { children?: ReactNode }) => h(Fragment, null, children);
  const withPortal = <T extends object>(ns: T) => ({ ...ns, Portal: Passthrough });
  return {
    ...actual,
    DropdownMenu: withPortal(actual.DropdownMenu),
    Popover: withPortal(actual.Popover),
  };
});

import {
  AppHeader,
  BrandLockup,
  BrandMark,
  CompanySwitcher,
  NAV_ITEMS,
  NavPill,
  PageRestricted,
  resolveNavItems,
  UserMenu,
  UserMenuItem,
} from "./index";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

const companies = [
  { id: "c1", name: "Acme GmbH" },
  { id: "c2", name: "Brightline Dental" },
  { id: "c3", name: "Nordwind Outdoor" },
];

// Figma 02 `375:22368` v2/shell.
describe("Brand mark / lockup (7:8, 7:12)", () => {
  it("renders the 32px primary mark with three bars", () => {
    const html = render(h(BrandMark));
    expect(classOf(html, "brand-mark")).toContain("size-8");
    expect(classOf(html, "brand-mark")).toContain("bg-primary");
    expect(count(html, 'data-slot="brand-mark-bar"')).toBe(3);
  });

  it("lockup pairs the mark with the Relay wordmark and links when given an href", () => {
    const html = render(h(BrandLockup, { href: "/home" }));
    expect(html).toContain('data-slot="brand-mark"');
    expect(html).toContain("Relay");
    expect(html).toContain("type-h3");
    expect(html).toMatch(/^<a[^>]*href="\/home"/);
    expect(render(h(BrandLockup, { href: null }))).toMatch(/^<div/);
  });
});

describe("Nav pill (375:22384)", () => {
  it("default: muted label, no underline, link to href", () => {
    const html = render(h(NavPill, { href: "/operator", icon: "workflow", label: "Operator" }));
    expect(html).toMatch(/^<a[^>]*href="\/operator"/);
    expect(html).toContain('data-state="default"');
    expect(classOf(html, "nav-pill")).toContain("text-muted-foreground");
    expect(classOf(html, "nav-pill")).toContain("hover:bg-secondary");
    expect(html).not.toContain("nav-pill-underline");
    expect(html).toContain('data-icon="workflow"');
  });

  it("active: filled pill, teal glowing underline, aria-current", () => {
    const html = render(h(NavPill, { href: "/home", icon: "house", label: "Home", active: true }));
    expect(html).toContain('data-state="active"');
    expect(html).toContain('aria-current="page"');
    expect(classOf(html, "nav-pill")).toContain("bg-nav-active");
    expect(classOf(html, "nav-pill-underline")).toContain("shadow-glow-primary");
  });
});

describe("resolveNavItems", () => {
  it("owner sees the five tabs in Figma order", () => {
    expect(resolveNavItems({ role: "owner" }).map((i) => i.key)).toEqual([
      "home",
      "operator",
      "inbox",
      "analytics",
      "agents",
    ]);
  });

  it("member never sees Agents, and show flags hide ungranted tabs", () => {
    expect(resolveNavItems({ role: "member" }).map((i) => i.key)).not.toContain("agents");
    expect(
      resolveNavItems({ role: "member", show: { inbox: false, analytics: false } }).map((i) => i.key),
    ).toEqual(["home", "operator"]);
    expect(resolveNavItems({ role: "member", show: { agents: true } }).map((i) => i.key)).not.toContain("agents");
  });

  it("maps every tab to its Figma icon", () => {
    expect(Object.fromEntries(NAV_ITEMS.map((i) => [i.key, i.icon]))).toEqual({
      home: "house",
      operator: "workflow",
      inbox: "inbox",
      analytics: "chart-no-axes-column",
      agents: "bot",
    });
  });
});

describe("App header (375:24991)", () => {
  it("owner, active=home: brand, switcher slot, five pills, bell with dot, user slot", () => {
    const html = render(
      h(AppHeader, {
        role: "owner",
        active: "home",
        unread: true,
        companySwitcher: h("span", { "data-testid": "switcher" }),
        userMenu: h("span", { "data-testid": "user" }),
      }),
    );
    expect(classOf(html, "app-header")).toContain("h-18");
    expect(html).toContain('data-slot="brand-lockup"');
    expect(html).toContain('data-testid="switcher"');
    expect(html).toContain('data-testid="user"');
    expect(count(html, 'data-slot="nav-pill"')).toBe(5);
    expect(count(html, 'data-state="active"')).toBe(1);
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('data-slot="icon-button-dot"');
    expect(classOf(html, "app-header-nav")).toContain("bg-nav");
  });

  it("member, active=none: four pills max, none active, no dot", () => {
    const html = render(h(AppHeader, { role: "member", active: "none" }));
    expect(count(html, 'data-slot="nav-pill"')).toBe(4);
    expect(html).not.toContain('data-state="active"');
    expect(html).not.toContain("Agents");
    expect(html).not.toContain('data-slot="icon-button-dot"');
  });
});

describe("User menu (375:24037) and item (375:23842)", () => {
  const user = { name: "Talha Bera", image: null };

  it("item: 36px row, 16px icon, body label", () => {
    const html = render(
      h(DropdownMenu, { open: true }, h(DropdownMenuTrigger, null, "x"), h(DropdownMenuContent, null, h(UserMenuItem, { icon: "user", label: "Profile" }))),
    );
    expect(classOf(html, "user-menu-item")).toContain("h-9");
    expect(classOf(html, "user-menu-item")).toContain("gap-3");
    expect(html).toContain('data-icon="user"');
    expect(html).toContain("Profile");
  });

  it("owner: identity, Profile, Preferences, Settings, Sign out", () => {
    const html = render(h(UserMenu, { role: "owner", user, meta: "Owner · Acme GmbH", open: true }));
    expect(html).toContain("Talha Bera");
    expect(html).toContain("Owner · Acme GmbH");
    expect(html).toContain(">TB<");
    for (const label of ["Profile", "Preferences", "Settings", "Sign out"]) expect(html).toContain(label);
    expect(html).not.toContain("View client portal");
    expect(count(html, 'data-slot="user-menu-item"')).toBe(4);
    expect(classOf(html, "user-menu-content")).toContain("w-65");
  });

  it("member: no Settings", () => {
    const html = render(h(UserMenu, { role: "member", user: { name: "Deniz Aksoy" }, meta: "Operator · Acme GmbH", open: true }));
    expect(html).not.toContain("Settings");
    expect(count(html, 'data-slot="user-menu-item"')).toBe(3);
  });

  it("+item: View client portal after Settings when a href is given", () => {
    const html = render(
      h(UserMenu, { role: "owner", user, meta: "Owner · Acme GmbH", clientPortalHref: "/client/live/preview", open: true }),
    );
    expect(html).toContain("View client portal");
    expect(html).toContain('data-icon="eye"');
    expect(html).toContain('href="/client/live/preview"');
    expect(html.indexOf("Settings")).toBeLessThan(html.indexOf("View client portal"));
    expect(html.indexOf("View client portal")).toBeLessThan(html.indexOf("Sign out"));
  });

  it("trigger: ringed avatar, name, chevron", () => {
    const html = render(h(UserMenu, { role: "owner", user, meta: "Owner" }));
    expect(classOf(html, "user-menu-trigger")).toContain("rounded-full");
    expect(html).toContain("border-primary");
    expect(html).toContain('data-icon="chevron-down"');
    expect(html).not.toContain("Sign out");
  });
});

describe("Company switcher (9:95)", () => {
  it("closed: pill trigger with initials, name and chevron", () => {
    const html = render(h(CompanySwitcher, { companies, activeCompanyId: "c1" }));
    expect(html).toContain('data-state-name="closed"');
    expect(classOf(html, "company-switcher-trigger")).toContain("rounded-full");
    expect(html).toContain(">AG<");
    expect(html).toContain("Acme GmbH");
    expect(html).toContain('data-icon="chevron-down"');
  });

  it("open: Switch company heading, one row per company, check on the active one", () => {
    const html = render(h(CompanySwitcher, { companies, activeCompanyId: "c1", open: true }));
    expect(html).toContain('data-state-name="open"');
    expect(html).toContain("Switch company");
    expect(count(html, 'data-slot="company-switcher-row"')).toBe(3);
    expect(count(html, 'data-icon="check"')).toBe(1);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Nordwind Outdoor");
  });

  it("loading: skeletons and a disabled trigger", () => {
    const html = render(h(CompanySwitcher, { companies: [], loading: true }));
    expect(html).toContain('data-state-name="loading"');
    expect(count(html, 'data-slot="skeleton"')).toBe(2);
    expect(html).toContain("disabled");
  });

  it("single: no chevron, not a menu", () => {
    const html = render(h(CompanySwitcher, { companies: companies.slice(0, 1), activeCompanyId: "c1" }));
    expect(html).toContain('data-state-name="single"');
    expect(html).not.toContain('data-icon="chevron-down"');
    expect(html).not.toContain("<button");
  });

  it("renders nothing without companies", () => {
    expect(render(h(CompanySwitcher, { companies: [] }))).toBe("");
  });
});

describe("Page restricted (10:80)", () => {
  it("card with lock tile, copy and Back to Home", () => {
    const html = render(h(PageRestricted));
    expect(classOf(html, "page-restricted")).toContain("rounded-2xl");
    expect(classOf(html, "page-restricted")).toContain("p-10");
    expect(html).toContain('data-icon="lock"');
    expect(html).toContain("You do not have access to this page");
    expect(html).toContain("Ask a company owner to grant you access, then reload.");
    expect(html).toContain('href="/home"');
    expect(html).toContain('data-icon="arrow-left"');
    expect(html).toContain("Back to Home");
  });

  it("accepts custom copy and hides the action when actionHref is null", () => {
    const html = render(h(PageRestricted, { title: "Inbox isn't available", description: "Ask an owner.", actionHref: null }));
    expect(html).toContain("Inbox isn&#x27;t available");
    expect(html).not.toContain("Back to Home");
  });
});
