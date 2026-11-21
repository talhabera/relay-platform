"use client";

import * as React from "react";

import {
  MARKETING_FOOTER_COLUMNS,
  MARKETING_NAV_LINKS,
  MarketingFooter,
  MarketingNav,
  type FooterColumn,
  type MarketingLink,
} from "@/components/v2/marketing";

import { RequestAccessProvider, useRequestAccess } from "./request-access";

/** Landing anchors (Figma 09 landing sections) and the standalone pricing page (S68). */
const HREF_OVERRIDES: Record<string, string> = {
  "/#pricing": "/pricing",
  "/#about": "/#how-it-works",
  "/#features": "/#how-it-works",
};

const remap = (link: MarketingLink): MarketingLink => ({ ...link, href: HREF_OVERRIDES[link.href] ?? link.href });

export const LANDING_NAV_LINKS: readonly MarketingLink[] = MARKETING_NAV_LINKS.map(remap);

/** Footer "Contact" keeps `/#contact`: the RequestAccessProvider opens the dialog on that hash. */
export const LANDING_FOOTER_COLUMNS: readonly FooterColumn[] = MARKETING_FOOTER_COLUMNS.map((column) => ({
  ...column,
  links: column.links.map(remap),
}));

function Nav() {
  const ctx = useRequestAccess();
  return <MarketingNav links={LANDING_NAV_LINKS} onRequestAccess={ctx ? () => ctx.openRequestAccess("none") : undefined} />;
}

/** Figma 09 `nav-footer/*`: Marketing nav, page, Marketing footer, one Request access dialog. */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <RequestAccessProvider>
      <div className="flex min-h-svh flex-col bg-background">
        <Nav />
        <main className="flex-1">{children}</main>
        <MarketingFooter columns={LANDING_FOOTER_COLUMNS} />
      </div>
    </RequestAccessProvider>
  );
}
