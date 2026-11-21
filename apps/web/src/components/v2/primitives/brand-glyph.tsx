import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./icon";

type Mark = { icon: IconName } | { monogram: string };

/**
 * Figma `Brand glyph` brand -> tile + mark. Marks are generic Lucide icons or monograms,
 * never trademark artwork (Figma component description).
 */
const brandGlyphs = {
  whatsapp: { tile: "bg-brand-whatsapp text-[var(--white)]", mark: { icon: "message-circle" } },
  instagram: { tile: "bg-brand-instagram text-[var(--white)]", mark: { icon: "camera" } },
  messenger: { tile: "bg-brand-messenger text-[var(--white)]", mark: { icon: "zap" } },
  telegram: { tile: "bg-brand-telegram text-[var(--white)]", mark: { icon: "send" } },
  website: { tile: "bg-secondary text-secondary-foreground", mark: { icon: "globe" } },
  google: { tile: "bg-brand-google text-[var(--white)]", mark: { monogram: "G" } },
  trustpilot: { tile: "bg-brand-trustpilot text-[var(--white)]", mark: { icon: "star" } },
  linkedin: { tile: "bg-brand-linkedin text-[var(--white)]", mark: { monogram: "in" } },
  facebook: { tile: "bg-brand-facebook text-[var(--white)]", mark: { monogram: "F" } },
  shopify: { tile: "bg-brand-shopify text-[var(--ink-950)]", mark: { monogram: "S" } },
  slack: { tile: "bg-brand-slack text-[var(--white)]", mark: { icon: "hash" } },
  zendesk: { tile: "bg-brand-zendesk text-[var(--white)]", mark: { monogram: "Z" } },
  hunter: { tile: "bg-brand-hunter text-[var(--white)]", mark: { monogram: "H" } },
  snov: { tile: "bg-secondary text-secondary-foreground", mark: { icon: "at-sign" } },
  "google-places": { tile: "bg-brand-google text-[var(--white)]", mark: { icon: "map-pin" } },
  "google-workspace": { tile: "bg-brand-google text-[var(--white)]", mark: { icon: "mail" } },
  meta: { tile: "bg-secondary text-secondary-foreground", mark: { monogram: "M" } },
  "google-business": { tile: "bg-brand-google text-[var(--white)]", mark: { icon: "store" } },
  email: { tile: "bg-secondary text-secondary-foreground", mark: { icon: "mail" } },
} as const satisfies Record<string, { tile: string; mark: Mark }>;

export type BrandName = keyof typeof brandGlyphs;

export const brandGlyphNames = Object.keys(brandGlyphs) as BrandName[];

export function isBrandName(value: string): value is BrandName {
  return Object.prototype.hasOwnProperty.call(brandGlyphs, value);
}

/** Glyph box and stroke per tile size (Figma: 12px glyph at 1.25 in 16 tiles, 16px at 1.5 in 24 tiles). */
const glyphMetrics = {
  16: { box: 12, stroke: 1.25 },
  24: { box: 16, stroke: 1.5 },
} as const;

type BrandGlyphProps = Omit<React.ComponentProps<"span">, "children"> & {
  brand: BrandName;
  /** Figma `size=16|24` (tile edge in px). */
  size?: 16 | 24;
  /** Accessible name. Omit when a visible label sits next to the glyph (decorative). */
  label?: string;
};

/** Figma `Brand glyph` (02 `344:20072`): 19 brands x size 16 | 24, radius/sm tile. */
function BrandGlyph({ className, brand, size = 16, label, ...props }: BrandGlyphProps) {
  const { tile, mark } = brandGlyphs[brand] as { tile: string; mark: Mark };
  const metrics = glyphMetrics[size];
  return (
    <span
      data-slot="brand-glyph"
      data-brand={brand}
      data-size={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
        size === 16 ? "size-4" : "size-6",
        tile,
        className,
      )}
      {...props}
    >
      {"icon" in mark ? (
        <Icon name={mark.icon} size={metrics.box} strokeWidth={metrics.stroke} absoluteStrokeWidth />
      ) : (
        <span
          className={cn(
            "whitespace-nowrap text-center",
            size === 24 ? "type-body-strong" : brand === "linkedin" ? "type-caption" : "type-label",
          )}
        >
          {mark.monogram}
        </span>
      )}
    </span>
  );
}

export { BrandGlyph };
export type { BrandGlyphProps };
