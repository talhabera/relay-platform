import { BrandGlyph, type BrandName } from "@/components/v2/primitives";

export const LANDING_SOURCES: readonly { brand: BrandName; label: string }[] = [
  { brand: "website", label: "Website widget" },
  { brand: "whatsapp", label: "WhatsApp" },
  { brand: "instagram", label: "Instagram" },
  { brand: "shopify", label: "Shopify" },
  { brand: "google-places", label: "Google Places" },
  { brand: "hunter", label: "Hunter" },
  { brand: "snov", label: "Snov" },
  { brand: "slack", label: "Slack" },
  { brand: "google-workspace", label: "Google Workspace" },
];

/** Figma 09 `section/sources` (`414:60504`): bordered strip of Brand glyph (24) + label pairs. */
export function SourcesSection() {
  return (
    <section
      data-slot="landing-sources"
      className="flex w-full flex-col items-center gap-4 border-y border-border px-6 py-12 md:px-20 md:py-10"
    >
      <p className="text-center type-small text-muted-foreground">
        Answers on every source your clients use. Works with the tools you already pay for.
      </p>
      <ul className="flex w-full max-w-[1280px] flex-wrap items-center justify-center gap-x-8 gap-y-4">
        {LANDING_SOURCES.map((source) => (
          <li key={source.brand} className="flex items-center gap-2">
            <BrandGlyph brand={source.brand} size={24} />
            <span className="type-body-strong whitespace-nowrap text-foreground">{source.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
