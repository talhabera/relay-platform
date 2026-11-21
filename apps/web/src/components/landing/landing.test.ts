import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(marketing)/actions", () => ({ requestAccess: vi.fn() }));

import LandingPage from "@/app/(marketing)/page";

import { LANDING_FOOTER_COLUMNS, LANDING_NAV_LINKS, MarketingShell } from "./marketing-shell";
import { formatPlanPrice, planAgentLimits, PLANS } from "./plans";
import { PricingContent } from "./pricing-content";
import { RequestAccessButton, RequestAccessProvider } from "./request-access";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("plans.ts (spec §1-3)", () => {
  it("EUR 0 / 49 / 39 yearly / Custom", () => {
    const [free, pro, enterprise] = PLANS;
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "enterprise"]);
    expect(formatPlanPrice(free, "monthly")).toBe("€0");
    expect(formatPlanPrice(pro, "monthly")).toBe("€49");
    expect(formatPlanPrice(pro, "yearly")).toBe("€39");
    expect(formatPlanPrice(enterprise, "monthly")).toBe("Custom");
  });

  it("counts customer agents only; operator agents unlimited", () => {
    expect(PLANS.map((p) => planAgentLimits(p)[0])).toEqual([
      "1 customer agent",
      "10 customer agents",
      "Unlimited customer agents",
    ]);
    expect(PLANS.every((p) => planAgentLimits(p)[1] === "Unlimited operator agents")).toBe(true);
  });

  it("pricing content shows € and no $", () => {
    const html = render(h(RequestAccessProvider, null, h(PricingContent)));
    expect(html).toContain("€0");
    expect(html).toContain("€49");
    expect(html).not.toMatch(/\$\d/);
    expect(html).toContain('data-plan="enterprise"');
    expect(html).toContain("Contact sales");
  });
});

describe("Landing (Figma 09 1:10 landing/*)", () => {
  const html = render(h(LandingPage));

  it("renders the eight sections in order", () => {
    const slots = [
      "landing-hero",
      "landing-sources",
      "landing-how-it-works",
      "landing-two-kinds",
      "landing-workflows",
      "landing-checkpoints",
      "landing-faq",
      "landing-cta",
    ];
    const positions = slots.map((slot) => html.indexOf(`data-slot="${slot}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("hero copy, one h1, product preview", () => {
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain("More qualified leads for every client.");
    expect(html).toContain("Closed beta · invite only");
    expect(html).toContain('data-slot="product-preview"');
    expect(html).toContain('data-slot="goal-strip"');
    expect(count(html, 'data-slot="workflow-stage-node"')).toBe(4);
    expect(html).not.toContain("No agent");
  });

  it("nine sources (shipped channels only), six roster chips, four steps and workflows, four FAQs", () => {
    expect(count(html, 'data-slot="brand-glyph"')).toBeGreaterThanOrEqual(9 + 3);
    expect(html).toContain("Google Workspace");
    expect(count(html, 'data-kind="operator"')).toBeGreaterThanOrEqual(6);
    expect(html).toContain("Four workflows, ready on day one.");
    expect(count(html, 'data-slot="faq-item"')).toBe(4);
    expect(html).toContain("Approve &amp; schedule");
  });

  it("CTAs are Request access buttons (no provider = /#request-access link), no sign-up", () => {
    expect(count(html, "Request access")).toBe(2);
    expect(count(html, 'href="/#request-access"')).toBe(2);
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toMatch(/sign up|create account|contact-section/i);
  });

  it("anchors match nav and footer links", () => {
    for (const id of ["how-it-works", "customer-agents", "operator-workflows", "faq"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("Marketing shell (09 nav-footer/*)", () => {
  it("nav and footer, CTAs open the dialog (buttons, not links)", () => {
    const html = render(h(MarketingShell, null, h(LandingPage)));
    expect(html).toContain('data-slot="marketing-nav"');
    expect(html).toContain('data-slot="marketing-footer"');
    expect(html).not.toContain('href="/#request-access"');
    expect(count(html, "Request access</button>")).toBeGreaterThanOrEqual(3);
  });

  it("pricing goes to /pricing; Contact stays on the dialog hash", () => {
    expect(LANDING_NAV_LINKS.find((l) => l.label === "Pricing")?.href).toBe("/pricing");
    const links = LANDING_FOOTER_COLUMNS.flatMap((c) => c.links);
    expect(links.find((l) => l.label === "Pricing")?.href).toBe("/pricing");
    expect(links.find((l) => l.label === "Contact")?.href).toBe("/#contact");
  });

  it("RequestAccessButton carries its plan preset", () => {
    const html = render(h(RequestAccessProvider, null, h(RequestAccessButton, { plan: "pro" })));
    expect(html).toMatch(/<button[^>]*data-plan="pro"[^>]*>Request access<\/button>/);
  });
});
