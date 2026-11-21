// Starting points for the create-agent dialogs (Figma 07 `agents-customer/create-agent` 599:15618,
// `agents-operator/create-agent` 600:81042). Pure data: the dialogs render it and the server
// actions resolve a start id to its instructions.

export type AgentModel = "haiku" | "sonnet" | "opus";

export const MODEL_OPTIONS: readonly { value: AgentModel; label: string }[] = [
  { value: "haiku", label: "Claude Haiku" },
  { value: "sonnet", label: "Claude Sonnet" },
  { value: "opus", label: "Claude Opus" },
];

export function modelLabel(model: AgentModel): string {
  return MODEL_OPTIONS.find((m) => m.value === model)?.label ?? model;
}

export const CUSTOMER_START_IDS = ["quotes", "support", "blank"] as const;
export type CustomerStartId = (typeof CUSTOMER_START_IDS)[number];

export const CUSTOMER_STARTS: readonly { id: CustomerStartId; label: string; instructions: string }[] = [
  {
    id: "quotes",
    label: "Quote requests and site visits",
    instructions: [
      "You answer people who want a quote or a site visit.",
      "Ask what they need, where, how large the job is and when it should happen. Ask one question at a time.",
      "Never promise a price or a date. Say a person will confirm both.",
      "When you have the need, the location and a way to reach them, thank them and say when they will hear back.",
    ].join("\n"),
  },
  {
    id: "support",
    label: "Customer support and FAQs",
    instructions: [
      "You answer customer questions from the knowledge you have been given.",
      "Keep answers short and friendly. If the knowledge does not cover a question, say so and offer to pass it to a person.",
      "Never invent prices, opening hours or policies.",
    ].join("\n"),
  },
  { id: "blank", label: "Blank agent", instructions: "" },
];

export function customerStartInstructions(id: CustomerStartId): string {
  return CUSTOMER_STARTS.find((s) => s.id === id)?.instructions ?? "";
}

export const OPERATOR_ROLE_IDS = ["lead-gatherer", "lead-qualifier", "mail-marketer", "social-media-manager", "market-analyst"] as const;
export type OperatorRoleId = (typeof OPERATOR_ROLE_IDS)[number];

export type OperatorRole = {
  id: OperatorRoleId;
  name: string;
  model: AgentModel;
  description: string;
  instructions: string;
};

export const OPERATOR_ROSTER: readonly OperatorRole[] = [
  {
    id: "lead-gatherer",
    name: "Lead Gatherer",
    model: "haiku",
    description: "Finds businesses that match the ideal customer profile and adds them as leads.",
    instructions:
      "Find businesses that match the company's ideal customer profile. Add each one as a lead with its name, website, location and the reason it fits. Skip businesses that are already leads.",
  },
  {
    id: "lead-qualifier",
    name: "Lead Qualifier",
    model: "sonnet",
    description: "Scores new leads 0-100 against the ideal customer profile and explains each score.",
    instructions:
      "Score each new lead from 0 to 100 against the ideal customer profile. Give the reasons for the score. Mark leads at 70 or above as qualified and leads below 50 as rejected; ask a person about the rest.",
  },
  {
    id: "mail-marketer",
    name: "Mail Marketer",
    model: "sonnet",
    description: "Drafts outreach and follow-up emails for qualified leads. A person approves every send.",
    instructions:
      "Draft short, personal outreach emails for qualified leads, then follow-ups for leads that have not replied. Propose every send as a checkpoint; never send without approval.",
  },
  {
    id: "social-media-manager",
    name: "Social Media Manager",
    model: "sonnet",
    description: "Plans, drafts and schedules posts for Instagram, Facebook and LinkedIn.",
    instructions:
      "Plan and draft posts for the company's social channels in its tone of voice. Propose each post with its channel and time as a checkpoint; never publish without approval.",
  },
  {
    id: "market-analyst",
    name: "Market Analyst",
    model: "opus",
    description: "Researches competitors and the market and writes findings into company memory.",
    instructions:
      "Research competitors, prices and demand in the company's market. Write short, sourced findings into company memory and flag anything that should change the plan.",
  },
];

export function operatorRole(id: string): OperatorRole | undefined {
  return OPERATOR_ROSTER.find((r) => r.id === id);
}
