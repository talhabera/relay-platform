import type { Metadata } from "next";

import { CheckpointsSection } from "@/components/landing/checkpoints-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { HeroSection } from "@/components/landing/hero-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { SourcesSection } from "@/components/landing/sources-section";
import { TwoKindsSection } from "@/components/landing/two-kinds-section";
import { WorkflowsSection } from "@/components/landing/workflows-section";

export const metadata: Metadata = {
  title: {
    absolute: "Relay — More qualified leads for every client",
  },
  description:
    "Relay runs a lead engine for each client company. Operator agents gather, qualify and write the outreach; customer agents answer on the client's website, WhatsApp and Instagram.",
  openGraph: {
    title: "Relay — More qualified leads for every client",
    description: "A lead engine per client, with a checkpoint before anything goes out. Closed beta.",
    type: "website",
  },
};

/** Figma 09 `landing/*` (`414:55519` desktop, `416:484` 390): eight sections. */
export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <SourcesSection />
      <HowItWorksSection />
      <TwoKindsSection />
      <WorkflowsSection />
      <CheckpointsSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
