import Link from "next/link";

import { Button } from "@/components/ui/button";

import { RequestAccessButton } from "./request-access";
import { LandingSection } from "./section";

/** Figma 09 `section/cta` (`415:60355`): canvas band, Request access + Sign in. */
export function CtaSection() {
  return (
    <LandingSection data-slot="landing-cta" className="md:pb-20">
      <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-canvas px-6 py-16 text-center md:px-12">
        <h2 className="type-h2 text-foreground">Give every client a lead engine.</h2>
        <p className="max-w-[560px] type-body text-muted-foreground">
          Relay is invite-only while we onboard agencies. Tell us about your clients and we set up the first workflow
          with you.
        </p>
        <div className="flex w-full flex-col gap-3 pt-2 md:w-auto md:flex-row">
          <RequestAccessButton size="lg" className="w-full md:w-auto" />
          <Button asChild variant="ghost" size="lg" className="w-full md:w-auto">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>
    </LandingSection>
  );
}
