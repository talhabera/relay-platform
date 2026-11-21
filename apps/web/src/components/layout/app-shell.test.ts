import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/home" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/lib/auth-actions", () => ({ signOutAction: vi.fn() }));

import { CompanyContextProvider } from "@/components/shared/company-context";
import { OWNER_PAGE_PERMISSIONS, normalizePagePermissions } from "@/db/schema";
import type { Company } from "@/types";

import { AppShellHeader } from "./app-shell";
import { needsYouBellLabel } from "./needs-you-bell";

const company = (id: string, name: string, ownerId: string) => ({ id, name, ownerId }) as Company;
const user = { name: "Dana Kim" };

function renderShell({
  userId,
  companies,
  permissions,
  pathname = "/home",
}: {
  userId: string;
  companies: Company[];
  permissions: Record<string, ReturnType<typeof normalizePagePermissions>>;
  pathname?: string;
}) {
  nav.pathname = pathname;
  return renderToStaticMarkup(
    h(CompanyContextProvider, {
      companies,
      userId,
      permissionsByCompanyId: permissions,
      initialActiveCompanyId: companies[0]?.id,
      children: h(AppShellHeader, { user }),
    }),
  );
}

const navLabels = (html: string) =>
  [...html.matchAll(/data-slot="nav-pill"[^>]*>.*?<\/svg>([^<]+)/g)].map((m) => m[1]);

describe("AppShellHeader", () => {
  it("owner: five tabs, active from pathname, multi-company switcher", () => {
    const html = renderShell({
      userId: "u1",
      companies: [company("c1", "Acme GmbH", "u1"), company("c2", "Brightline", "u1")],
      permissions: { c1: OWNER_PAGE_PERMISSIONS, c2: OWNER_PAGE_PERMISSIONS },
      pathname: "/operator/agents/x",
    });
    expect(html).toContain('data-role="owner"');
    expect(navLabels(html)).toEqual(["Home", "Operator", "Inbox", "Analytics", "Agents"]);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/operator"|href="\/operator"[^>]*aria-current="page"/);
    expect(html).toContain('data-state-name="closed"');
    expect(html).toContain("Dana Kim");
  });

  it("member: only granted tabs, never Agents, single-company switcher", () => {
    const html = renderShell({
      userId: "u2",
      companies: [company("c1", "Acme GmbH", "u1")],
      permissions: { c1: normalizePagePermissions({ messaging: true, agents: true }) },
      pathname: "/analytics",
    });
    expect(html).toContain('data-role="member"');
    expect(navLabels(html)).toEqual(["Home", "Inbox"]);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('data-state-name="single"');
  });

  it("member without grants sees only Home", () => {
    const html = renderShell({
      userId: "u2",
      companies: [company("c1", "Acme GmbH", "u1")],
      permissions: { c1: normalizePagePermissions(null) },
    });
    expect(navLabels(html)).toEqual(["Home"]);
  });

  it("no company: no switcher, Home tab only", () => {
    const html = renderShell({ userId: "u3", companies: [], permissions: {} });
    expect(html).not.toContain("company-switcher-trigger");
    expect(navLabels(html)).toEqual(["Home"]);
  });

  it("bell: the Needs you bell with a company, the plain bell without one (S46)", () => {
    const withCompany = renderShell({
      userId: "u1",
      companies: [company("c1", "Acme GmbH", "u1")],
      permissions: { c1: OWNER_PAGE_PERMISSIONS },
    });
    expect(withCompany).toContain('aria-label="Needs you: nothing open"');
    const none = renderShell({ userId: "u3", companies: [], permissions: {} });
    expect(none).toContain('aria-label="Notifications"');
  });
});

describe("needsYouBellLabel", () => {
  it("names the open count", () => {
    expect(needsYouBellLabel(0)).toBe("Needs you: nothing open");
    expect(needsYouBellLabel(5)).toBe("Needs you: 5 open");
  });
});
