"use client";

import * as React from "react";

import { Separator } from "@/components/ui/separator";
import { Icon, Segmented, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { formatPlanPrice, planAgentLimits, PLANS, YEARLY_DISCOUNT_LABEL, type Plan, type PlanId } from "./plans";
import { RequestAccessButton } from "./request-access";
import { LandingSection, SectionHead, landingCardClass } from "./section";

type Feature = { text: string; included: boolean };
type Billing = "monthly" | "yearly";

/** Feature rows as drawn (Figma 09 `plan/*`); prices, limits and CTAs come from `plans.ts`. */
const FEATURES: Record<PlanId, readonly Feature[]> = {
  free: [
    { text: "100 messages/month", included: true },
    { text: "1 channel", included: true },
    { text: "Basic analytics", included: true },
    { text: "Community support", included: true },
    { text: "Integrations", included: false },
    { text: "Custom branding", included: false },
    { text: "Priority support", included: false },
    { text: "API access", included: false },
  ],
  pro: [
    { text: "Unlimited messages", included: true },
    { text: "All channels", included: true },
    { text: "Full analytics", included: true },
    { text: "Priority support", included: true },
    { text: "Integrations", included: true },
    { text: "Custom branding", included: true },
    { text: "API access", included: true },
    { text: "Dedicated account manager", included: false },
  ],
  enterprise: [
    { text: "Unlimited messages", included: true },
    { text: "All channels", included: true },
    { text: "Full analytics + custom reports", included: true },
    { text: "Dedicated support", included: true },
    { text: "Custom integrations", included: true },
    { text: "Custom branding", included: true },
    { text: "API access", included: true },
    { text: "Dedicated account manager", included: true },
  ],
};

function planFeatures(plan: Plan): readonly Feature[] {
  return [...planAgentLimits(plan).map((text) => ({ text, included: true })), ...FEATURES[plan.id]];
}

type Qa = { question: string; answer: string };

/**
 * Two columns as drawn (Figma 09 pricing `section/faq`). The channel answer lists the shipped
 * channels only (spec §4); agent counts say "customer agent" (§3).
 */
export const PRICING_FAQ: readonly (readonly Qa[])[] = [
  [
    {
      question: "What channels are supported?",
      answer:
        "Website widget, WhatsApp, Instagram and Shopify. Customer agents only; operator agents stay inside your agency.",
    },
    {
      question: "Can I try before I buy?",
      answer:
        "The Free plan includes one customer agent and 100 messages per month. Upgrade when you need more agents or channels.",
    },
  ],
  [
    {
      question: "Is my data used to train models?",
      answer:
        "No. Transcripts and knowledge stay in your company. Connector keys and HTTP header secrets never reach the model, the browser or logs.",
    },
    {
      question: "Can I cancel anytime?",
      answer: "Yes. The plan stays active until the end of the current billing period. No cancellation fee.",
    },
  ],
];

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  return (
    <div
      data-slot="plan-card"
      data-plan-id={plan.id}
      data-featured={plan.featured}
      className={cn(
        "flex min-w-0 flex-col items-start gap-8 rounded-xl bg-card p-6 md:p-10",
        plan.featured ? "border-2 border-primary shadow-elevation-2" : "border border-border shadow-elevation-1",
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <h2 className="type-h3 text-foreground">{plan.name}</h2>
        {plan.featured ? (
          <StatusChip tone="neutral" dot={false}>
            Usual pick
          </StatusChip>
        ) : null}
      </div>
      <p className="w-full type-body text-muted-foreground">{plan.description}</p>
      <p className="flex w-full items-baseline gap-2 whitespace-nowrap">
        <span className="type-display text-foreground">{formatPlanPrice(plan, billing)}</span>
        {plan.monthly == null ? null : <span className="type-small text-muted-foreground">/month</span>}
      </p>
      <RequestAccessButton
        plan={plan.id}
        size="lg"
        variant={plan.featured ? "default" : "outline"}
        className="w-full"
      >
        {plan.cta}
      </RequestAccessButton>
      <Separator />
      <ul className="flex w-full flex-col gap-3">
        {planFeatures(plan).map((feature) => (
          <li key={feature.text} data-included={feature.included} className="flex items-center gap-3">
            <Icon
              name={feature.included ? "check" : "x"}
              size={16}
              aria-hidden
              className={cn("shrink-0", feature.included ? "text-primary" : "text-muted-foreground")}
            />
            <span
              className={cn("min-w-0 flex-1 type-small", feature.included ? "text-foreground" : "text-muted-foreground")}
            >
              {feature.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Figma 09 `section/pricing-header` + `section/plans`: billing toggle, three plans, footnote. */
export function PricingContent() {
  const [billing, setBilling] = React.useState<Billing>("monthly");

  return (
    <>
      <section
        data-slot="pricing-header"
        className="flex w-full flex-col items-center gap-6 px-6 pt-12 pb-10 text-center md:px-20 md:pt-20"
      >
        <p className="type-label text-primary">Pricing</p>
        <h1 className="max-w-[880px] type-h1 text-foreground md:type-display">
          Closed beta. These are intended limits, not a cart.
        </h1>
        <p className="max-w-[640px] type-body text-muted-foreground">
          Same product on every plan, for every client company. Limits change, not the split between customer and
          operator agents. Sign in if you already have an invite.
        </p>
        <Segmented
          aria-label="Billing period"
          items={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: YEARLY_DISCOUNT_LABEL },
          ]}
          value={billing}
          onValueChange={(value) => setBilling(value === "yearly" ? "yearly" : "monthly")}
        />
      </section>

      <section data-slot="pricing-plans" className="w-full px-6 pb-12 md:px-20 md:pb-16">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-8">
          <div className="grid w-full items-start gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} billing={billing} />
            ))}
          </div>
          <p className="text-center type-small text-muted-foreground">
            Billing is handled after invite. There is no checkout during the closed beta.
          </p>
        </div>
      </section>
    </>
  );
}

/** Figma 09 pricing `section/faq`: two columns of cards. */
export function PricingFaqSection() {
  return (
    <LandingSection id="faq" data-slot="pricing-faq">
      <SectionHead eyebrow="FAQ" title="Before you pick a plan" />
      <div className="grid w-full items-start gap-6 lg:grid-cols-2">
        {PRICING_FAQ.map((column, index) => (
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
