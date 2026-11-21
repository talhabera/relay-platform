import type { IconName } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { IconTile, LandingSection, SectionHead, landingCardClass } from "./section";

const STEPS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "magnet",
    title: "Gather",
    body: "Lead Gatherer searches Google Places, Hunter and Snov for offices that fit the client's ideal customer.",
  },
  {
    icon: "target",
    title: "Qualify",
    body: "Lead Qualifier scores every lead against the client's criteria. Inbound leads from customer agents join the same queue.",
  },
  {
    icon: "mail",
    title: "Reach out",
    body: "Mail Marketer drafts the sequence and stops at a checkpoint. You approve, ask for changes or discard.",
  },
  {
    icon: "circle-check",
    title: "Deliver",
    body: "Qualified leads that replied go to the client, each with the reason it fits.",
  },
];

/** Figma 09 `section/how-it-works` (`414:60767`): head + four numbered step cards. */
export function HowItWorksSection() {
  return (
    <LandingSection id="how-it-works" data-slot="landing-how-it-works" className="md:pt-20">
      <SectionHead
        eyebrow="How it works"
        title="One lead engine per client. You stay in the loop."
        lede="Each client company gets its own workflow, agents and targets. This week at Acme GmbH: 146 gathered, 44 qualified, 31 contacted, 6 delivered."
      />
      <ol className="grid w-full gap-6 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className={cn("flex flex-col items-start gap-4", landingCardClass)}>
            <div className="flex w-full items-center justify-between">
              <IconTile icon={step.icon} />
              <span className="type-mono text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="type-h3 text-foreground">{step.title}</h3>
            <p className="type-small text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </LandingSection>
  );
}
