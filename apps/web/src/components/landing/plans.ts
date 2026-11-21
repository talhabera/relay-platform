/**
 * Marketing plans: copy, not product (spec 2026-10-02-pricing-and-access-requests §1-3).
 * Every price and limit on the marketing site reads from here, so a price change is a
 * one-line edit. EUR only. No enforcement, no checkout.
 */

export type PlanId = "free" | "pro" | "enterprise";

/** Plan preset sent with an access request; `none` for nav, hero, CTA band and footer. */
export type RequestAccessPlan = PlanId | "none";

export type Plan = {
  id: PlanId;
  name: string;
  /** EUR per month billed monthly; null = Custom. */
  monthly: number | null;
  /** EUR per month billed yearly; null = Custom. */
  yearly: number | null;
  description: string;
  /** Customer agents per agency account; null = unlimited. Operator agents are unlimited on every plan. */
  customerAgents: number | null;
  cta: "Request access" | "Contact sales";
  featured: boolean;
};

export const CURRENCY = "€";

/** "Yearly · 20% off" toggle label. */
export const YEARLY_DISCOUNT_LABEL = "Yearly · 20% off";

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
    description: "One customer agent to try Relay with a single client.",
    customerAgents: 1,
    cta: "Request access",
    featured: false,
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 49,
    yearly: 39,
    description: "Agencies running several clients.",
    customerAgents: 10,
    cta: "Request access",
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthly: null,
    yearly: null,
    description: "Custom volume and SLA.",
    customerAgents: null,
    cta: "Contact sales",
    featured: false,
  },
];

/** "€0", "€49", or "Custom". */
export function formatPlanPrice(plan: Plan, billing: "monthly" | "yearly"): string {
  const amount = billing === "yearly" ? plan.yearly : plan.monthly;
  return amount == null ? "Custom" : `${CURRENCY}${amount}`;
}

/** Honest agent limits: customer agents are counted, operator agents are not (§3). */
export function planAgentLimits(plan: Plan): [string, string] {
  const customer =
    plan.customerAgents == null
      ? "Unlimited customer agents"
      : `${plan.customerAgents} customer agent${plan.customerAgents === 1 ? "" : "s"}`;
  return [customer, "Unlimited operator agents"];
}
