import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandGlyph, brandGlyphNames, isBrandName, type BrandName } from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const tileClass = (html: string) => html.match(/^<span[^>]*class="([^"]*)"/)?.[1] ?? "";

const ICON_BRANDS: Record<string, string> = {
  whatsapp: "message-circle",
  instagram: "camera",
  messenger: "zap",
  telegram: "send",
  website: "globe",
  trustpilot: "star",
  slack: "hash",
  snov: "at-sign",
  "google-places": "map-pin",
  "google-workspace": "mail",
  "google-business": "store",
  email: "mail",
};

const MONOGRAMS: Record<string, string> = {
  google: "G",
  linkedin: "in",
  facebook: "F",
  shopify: "S",
  zendesk: "Z",
  hunter: "H",
  meta: "M",
};

describe("BrandGlyph", () => {
  it("covers the 19 Figma brands (38 variants with 2 sizes)", () => {
    expect(brandGlyphNames).toHaveLength(19);
    expect(brandGlyphNames.length * 2).toBe(38);
    expect(new Set([...Object.keys(ICON_BRANDS), ...Object.keys(MONOGRAMS)])).toEqual(new Set(brandGlyphNames));
    expect(isBrandName("whatsapp")).toBe(true);
    expect(isBrandName("tiktok")).toBe(false);
  });

  it.each(brandGlyphNames.flatMap((b) => ([16, 24] as const).map((s) => [b, s] as const)))(
    "renders %s at %i",
    (brand: BrandName, size) => {
      const html = render(h(BrandGlyph, { brand, size }));
      const cls = tileClass(html);
      expect(html).toContain(`data-brand="${brand}"`);
      expect(html).toContain(`data-size="${size}"`);
      expect(cls).toContain(size === 16 ? "size-4" : "size-6");
      expect(cls).toContain("rounded-sm");
      if (ICON_BRANDS[brand]) {
        expect(html).toContain(`data-icon="${ICON_BRANDS[brand]}"`);
        expect(html).toContain(`width="${size === 16 ? 12 : 16}"`);
      } else {
        expect(html).toContain(`>${MONOGRAMS[brand]}</span>`);
        expect(html).not.toContain("<svg");
      }
    },
  );

  it("uses brand tiles, google tile for google family and secondary for neutral brands", () => {
    expect(tileClass(render(h(BrandGlyph, { brand: "whatsapp" })))).toContain("bg-brand-whatsapp");
    expect(tileClass(render(h(BrandGlyph, { brand: "hunter" })))).toContain("bg-brand-hunter");
    for (const b of ["google", "google-places", "google-workspace", "google-business"] as const) {
      expect(tileClass(render(h(BrandGlyph, { brand: b })))).toContain("bg-brand-google");
    }
    for (const b of ["website", "snov", "meta", "email"] as const) {
      const cls = tileClass(render(h(BrandGlyph, { brand: b })));
      expect(cls).toContain("bg-secondary");
      expect(cls).toContain("text-secondary-foreground");
    }
    expect(tileClass(render(h(BrandGlyph, { brand: "slack" })))).toContain("text-[var(--white)]");
    expect(tileClass(render(h(BrandGlyph, { brand: "shopify" })))).toContain("text-[var(--ink-950)]");
  });

  it("matches the Figma glyph stroke (1.25 in 16 tiles, 1.5 in 24 tiles, absolute)", () => {
    const sm = render(h(BrandGlyph, { brand: "slack", size: 16 }));
    expect(sm).toContain('stroke-width="2.5"'); // 1.25 * 24 / 12
    const lg = render(h(BrandGlyph, { brand: "slack", size: 24 }));
    expect(lg).toContain('stroke-width="2.25"'); // 1.5 * 24 / 16
  });

  it("uses type/label for 16 monograms (linkedin caption) and type/body-strong for 24", () => {
    const g16 = render(h(BrandGlyph, { brand: "google", size: 16 }));
    expect(g16).toContain("type-label");
    expect(render(h(BrandGlyph, { brand: "linkedin", size: 16 }))).toContain("type-caption");
    expect(render(h(BrandGlyph, { brand: "google", size: 24 }))).toContain("type-body-strong");
  });

  it("is decorative by default and labelled when a label is given", () => {
    expect(render(h(BrandGlyph, { brand: "telegram" }))).toContain('aria-hidden="true"');
    const labelled = render(h(BrandGlyph, { brand: "telegram", label: "Telegram" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Telegram"');
    expect(labelled).not.toMatch(/^<span[^>]*aria-hidden/);
  });
});
