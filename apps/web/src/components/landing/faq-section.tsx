import { cn } from "@/lib/utils";

import { LandingSection, SectionHead, landingCardClass } from "./section";

type Qa = { question: string; answer: string };

/** Two columns as drawn (Figma 09 `section/faq` `415:60336`). */
export const LANDING_FAQ: readonly (readonly Qa[])[] = [
  [
    {
      question: "What are the two kinds of agent?",
      answer:
        "Customer agents answer your clients’ customers on the website widget, WhatsApp, Instagram and Shopify. Operator agents work for your team, with versioned instructions and their own tools. The kind is set at create and never changes.",
    },
    {
      question: "Is Relay open for signup?",
      answer:
        "No. Relay is in closed beta and you need an invite to sign in. There is no self-serve signup or checkout yet.",
    },
  ],
  [
    {
      question: "Who can use the Operator workspace?",
      answer:
        "Company members, not just owners. Owners grant each member the pages they need, and only people with approval rights can approve a checkpoint.",
    },
    {
      question: "Where do connector keys go?",
      answer:
        "They stay on the server. Keys for Hunter, Snov, Google Places and Slack never reach the browser, the model, logs or transcripts.",
    },
  ],
];

export function FaqSection() {
  return (
    <LandingSection id="faq" data-slot="landing-faq">
      <SectionHead eyebrow="FAQ" title="Questions agencies ask first" />
      <div className="grid w-full items-start gap-6 lg:grid-cols-2">
        {LANDING_FAQ.map((column, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-6">
            {column.map((qa) => (
              <div key={qa.question} data-slot="faq-item" className={cn("flex flex-col gap-2", landingCardClass)}>
                <h3 className="type-body-strong text-foreground">{qa.question}</h3>
                <p className="type-small text-muted-foreground">{qa.answer}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </LandingSection>
  );
}
