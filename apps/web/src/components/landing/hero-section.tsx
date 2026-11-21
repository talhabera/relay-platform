import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/v2/primitives";

import { ProductPreview } from "./product-preview";
import { RequestAccessButton } from "./request-access";

/** Figma 09 `hero` (desktop `414:55542`, mobile `416:486`): copy, CTAs, Lead engine preview. */
export function HeroSection() {
  return (
    <section
      data-slot="landing-hero"
      className="flex w-full flex-col items-center gap-16 px-6 pt-12 pb-12 md:px-20 md:pt-20 md:pb-16"
    >
      <div className="flex w-full max-w-[1040px] flex-col items-center gap-6 text-center">
        <Chip asStatic icon="sparkles" className="[&_svg]:text-foreground">
          Closed beta · invite only
        </Chip>
        <h1 className="type-h1 text-foreground md:type-display-xl">More qualified leads for every client.</h1>
        <p className="max-w-[640px] type-body text-muted-foreground">
          Relay runs a lead engine for each client company. Operator agents gather, qualify and write the outreach;
          customer agents answer on the client&apos;s website, WhatsApp and Instagram. Nothing goes out until you approve
          it.
        </p>
        <div className="flex w-full flex-col items-center gap-3 md:w-auto md:flex-row">
          <RequestAccessButton size="lg" className="w-full shadow-glow-primary md:w-auto" />
          <Button asChild variant="outline" size="lg" className="w-full md:w-auto">
            <Link href="#how-it-works">See how it works</Link>
          </Button>
        </div>
        <p className="type-caption text-muted-foreground">Invite only. Billing is handled after invite.</p>
      </div>
      <ProductPreview className="mx-auto max-w-[1280px]" />
    </section>
  );
}
