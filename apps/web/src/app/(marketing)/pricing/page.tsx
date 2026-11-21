import type { Metadata } from "next";

import { CtaSection } from "@/components/landing/cta-section";
import { PricingContent, PricingFaqSection } from "@/components/landing/pricing-content";

const description = "Free, Pro €49/month and Enterprise. Limits count customer agents; operator agents are unlimited.";

export const metadata: Metadata = {
  title: "Pricing — Relay",
  description,
  openGraph: { title: "Pricing — Relay", description, type: "website" },
};

/** Figma 09 `pricing/*` (`428:60871` desktop light, `428:61019` 390): header, plans, FAQ, CTA band. */
export default function PricingPage() {
  return (
    <>
      <PricingContent />
      <PricingFaqSection />
      <CtaSection />
    </>
  );
}
