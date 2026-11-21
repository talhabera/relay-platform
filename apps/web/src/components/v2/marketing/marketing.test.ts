import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MARKETING_FOOTER_COLUMNS, MARKETING_NAV_LINKS, MarketingFooter, MarketingNav } from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const count = (html: string, needle: string) => html.split(needle).length - 1;

// Figma 02 `411:40070` v2/marketing.
describe("Marketing nav (19:393)", () => {
  it("desktop: pill links, Sign in, Request access; no create-account CTA", () => {
    const html = render(h(MarketingNav));
    expect(MARKETING_NAV_LINKS.map((l) => l.label)).toEqual(["Features", "Pricing", "Blog"]);
    expect(html).toContain('data-slot="marketing-nav-links"');
    expect(html).toContain("shadow-elevation-2");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Request access");
    expect(html).not.toMatch(/sign up|create account/i);
  });

  it("mobile closed: menu button, no expanded panel", () => {
    const html = render(h(MarketingNav));
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-slot="marketing-nav-menu"');
  });

  it("mobile-open: close button, h3 links, full-width outline Sign in", () => {
    const html = render(h(MarketingNav, { defaultOpen: true }));
    expect(html).toContain('aria-label="Close menu"');
    expect(html).toContain('data-icon="x"');
    expect(html).toContain('data-slot="marketing-nav-menu"');
    expect(count(html, "type-h3 text-foreground")).toBe(3);
    expect(html).toMatch(/data-variant="outline"[^>]*data-size="lg"/);
    expect(count(html, "Request access")).toBe(2);
  });

  it("onRequestAccess renders a button instead of a link", () => {
    const html = render(h(MarketingNav, { onRequestAccess: () => {} }));
    expect(html).toMatch(/<button[^>]*>Request access<\/button>/);
    expect(html).not.toContain('href="/#request-access"');
  });
});

describe("Marketing footer (19:394)", () => {
  it("brand, tagline, four columns, closed-beta line", () => {
    const html = render(h(MarketingFooter, { year: 2026 }));
    expect(MARKETING_FOOTER_COLUMNS.map((c) => c.title)).toEqual(["Product", "Company", "Resources", "Legal"]);
    expect(count(html, 'data-slot="marketing-footer-column"')).toBe(4);
    expect(html).toContain('data-slot="brand-lockup"');
    expect(html).toContain("One desk for the agents your agency runs.");
    expect(html).toContain("Relay is in closed beta. Accounts are created by invitation only.");
    expect(html).toContain("© 2026 Relay");
    expect(html).toContain("md:px-20");
  });
});
