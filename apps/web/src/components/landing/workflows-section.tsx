import type { IconName } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { IconTile, LandingSection, SectionHead, landingCardClass } from "./section";

const WORKFLOWS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "workflow",
    title: "Lead engine",
    body: "Gather, qualify, reach out, deliver. A weekly target and cost per lead for every client.",
  },
  {
    icon: "calendar",
    title: "Content calendar",
    body: "October: 12 posts across Instagram, Facebook and LinkedIn. You review 3 before they are scheduled.",
  },
  {
    icon: "star",
    title: "Review management",
    body: "Replies drafted for new Google and Trustpilot reviews. The negative one comes to you first.",
  },
  {
    icon: "chart-no-axes-column",
    title: "Marketing analysis",
    body: "A weekly report on lead quality, cost per qualified lead and marketing performance.",
  },
];

/** Figma 09 `section/workflows` (`415:401`): four workflow cards. */
export function WorkflowsSection() {
  return (
    <LandingSection id="operator-workflows" data-slot="landing-workflows">
      <SectionHead eyebrow="Workflows" title="Four workflows, ready on day one." />
      <ul className="grid w-full gap-6 md:grid-cols-2 lg:grid-cols-4">
        {WORKFLOWS.map((workflow) => (
          <li key={workflow.title} className={cn("flex flex-col items-start gap-3", landingCardClass)}>
            <IconTile icon={workflow.icon} />
            <h3 className="type-h3 text-foreground">{workflow.title}</h3>
            <p className="type-small text-muted-foreground">{workflow.body}</p>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}
