import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(marketing)/actions", () => ({ requestAccess: vi.fn() }));

import { RequestAccessProvider } from "@/components/landing/request-access";
import { PRICING_FAQ } from "@/components/landing/pricing-content";

import PricingPage from "./page";

const render = (el: ReactElement) => renderToStaticMarkup(h(RequestAccessProvider, null, el));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("Pricing page (Figma 09 pricing/*, spec 2026-10-02 §1-4)", () => {
  const html = render(h(PricingPage));

  it("header: eyebrow, one h1, Monthly | Yearly · 20% off segmented control", () => {
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain("Closed beta. These are intended limits, not a cart.");
    expect(html).toContain('data-slot="segmented"');
    expect(html).toContain("Monthly");
    expect(html).toContain("Yearly · 20% off");
  });

  it("three plan cards in EUR, monthly by default, Pro featured", () => {
    expect(count(html, 'data-slot="plan-card"')).toBe(3);
    expect(html).toContain("€0");
    expect(html).toContain("€49");
    expect(html).not.toContain("€39");
    expect(html).toContain("Custom");
    expect(count(html, ">/month<")).toBe(2);
    expect(html).toMatch(/data-plan-id="pro"[^>]*data-featured="true"/);
    expect(html).toContain("Usual pick");
    expect(html).not.toMatch(/\$\d/);
  });

  it("limits count customer agents; operator agents unlimited", () => {
    expect(html).toContain("1 customer agent");
    expect(html).toContain("10 customer agents");
    expect(html).toContain("Unlimited customer agents");
    expect(count(html, "Unlimited operator agents")).toBe(3);
    expect(html).not.toMatch(/AI agents?</);
  });

  it("CTAs open the dialog with a plan preset", () => {
    for (const plan of ["free", "pro", "enterprise"]) expect(html).toContain(`data-plan="${plan}"`);
    expect(html).toMatch(/data-plan="enterprise"[^>]*>Contact sales</);
    expect(html).not.toContain('href="/sign-up"');
  });

  it("footnote, four FAQ cards, CTA band", () => {
    expect(html).toContain("There is no checkout during the closed beta.");
    expect(count(html, 'data-slot="faq-item"')).toBe(4);
    expect(html).toContain("Before you pick a plan");
    expect(html).toContain('data-slot="landing-cta"');
  });

  it("channel FAQ lists shipped channels only (§4)", () => {
    const channels = PRICING_FAQ.flat().find((qa) => qa.question === "What channels are supported?");
    expect(channels?.answer).toMatch(/widget.*WhatsApp.*Instagram.*Shopify/);
    expect(JSON.stringify(PRICING_FAQ)).not.toMatch(/Messenger|Telegram/);
  });
});
