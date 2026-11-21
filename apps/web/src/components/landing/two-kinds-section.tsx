import { AgentChip, BrandGlyph, Icon, type BrandName } from "@/components/v2/primitives";

import { LandingSection, SectionHead } from "./section";

const BINDINGS: readonly { agent: string; sources: readonly { brand: BrandName; label: string }[] }[] = [
  {
    agent: "Acme Website Assistant",
    sources: [
      { brand: "website", label: "Website widget" },
      { brand: "whatsapp", label: "WhatsApp" },
    ],
  },
  {
    agent: "Acme Instagram Concierge",
    sources: [
      { brand: "instagram", label: "Instagram" },
    ],
  },
];

const ROSTER: readonly { name: string; version: string; status: "live" | "draft" }[] = [
  { name: "Lead Gatherer", version: "v1", status: "live" },
  { name: "Lead Qualifier", version: "v1", status: "live" },
  { name: "Mail Marketer", version: "v1", status: "live" },
  { name: "Social Media Manager", version: "v1", status: "live" },
  { name: "Market Analyst", version: "v1", status: "live" },
  { name: "Lead Qualifier", version: "v2", status: "draft" },
];

const kindCardClass = "flex min-w-0 flex-col items-start gap-4 rounded-2xl border border-border bg-card p-8 shadow-elevation-1";

/** Figma 09 `section/two-kinds` (`414:63404`): customer vs operator agents, kind note. */
export function TwoKindsSection() {
  return (
    <LandingSection id="customer-agents" data-slot="landing-two-kinds">
      <SectionHead eyebrow="Two kinds of agent" title="Two kinds of agent. One desk." />
      <div className="grid w-full gap-6 lg:grid-cols-2">
        <article data-slot="kind-customer" className={kindCardClass}>
          <p className="type-label text-muted-foreground">Customer agents</p>
          <h3 className="type-h3 text-foreground">Answer your clients’ customers</h3>
          <p className="type-body text-muted-foreground">
            On the website widget, WhatsApp, Instagram and Shopify. Quote requests get answered, site visits
            get booked, and warm leads flow into Qualify.
          </p>
          <ul className="flex w-full flex-col gap-2 pt-2">
            {BINDINGS.map((binding) => (
              <li
                key={binding.agent}
                className="flex w-full flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <AgentChip kind="customer" name={binding.agent} />
                <span className="flex flex-wrap items-center gap-2">
                  {binding.sources.map((source) => (
                    <span key={source.brand} className="flex items-center gap-2">
                      <BrandGlyph brand={source.brand} size={16} />
                      <span className="type-small whitespace-nowrap text-foreground">{source.label}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </article>
        <article data-slot="kind-operator" className={kindCardClass}>
          <p className="type-label text-muted-foreground">Operator agents</p>
          <h3 className="type-h3 text-foreground">Work for your team</h3>
          <p className="type-body text-muted-foreground">
            A pre-defined roster runs Lead engine, Content calendar, Review management and Marketing analysis. Every
            agent is versioned; a draft never touches a live run.
          </p>
          <ul className="flex w-full flex-wrap items-start gap-2 pt-2">
            {ROSTER.map((agent) => (
              <li key={`${agent.name}-${agent.version}`}>
                <AgentChip kind="operator" name={agent.name} version={agent.version} status={agent.status} />
              </li>
            ))}
          </ul>
        </article>
      </div>
      <p className="flex items-start gap-2 type-small text-muted-foreground md:items-center">
        <Icon name="lock" size={16} className="mt-0.5 shrink-0 md:mt-0" />
        An agent’s kind is fixed when it is created. Operator agents never answer on customer sources.
      </p>
    </LandingSection>
  );
}
