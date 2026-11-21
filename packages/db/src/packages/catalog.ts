import type { ToolToggles } from "../schema/agent-versions";
import type { WorkflowFlow, WorkflowIntakeField } from "../schema/workflows";
import type { ConnectorCatalogType } from "../connectors/types";
import { LEAD_ENGINE_INTAKE } from "../lead-intake";
import {
  AD_MANAGER_INSTRUCTIONS,
  AD_MANAGER_PROMPT,
  AD_MONITOR_INSTRUCTIONS,
  AD_MONITOR_PROMPT,
  DAILY_MANAGER_INSTRUCTIONS,
  DAILY_MANAGER_PROMPT,
  LEAD_GATHERER_INSTRUCTIONS,
  LEAD_GATHERER_PROMPT,
  LEAD_QUALIFIER_INSTRUCTIONS,
  LEAD_QUALIFIER_PROMPT,
  MAIL_MARKETER_INSTRUCTIONS,
  MAIL_MARKETER_PROMPT,
  MARKET_ANALYST_INSTRUCTIONS,
  MARKET_ANALYST_PROMPT,
  SOCIAL_CONTENT_PROMPT,
  SOCIAL_MEDIA_MANAGER_INSTRUCTIONS,
  SOCIAL_REVIEWS_PROMPT,
} from "./instructions";

// Package catalog (spec 2026-10-02-packages, decision 1). A code constant
// shared by web and worker. `revenue` left the catalog in S81: existing
// Revenue agents keep working as ordinary operator agents.

export const PACKAGE_SLUGS = [
  "lead-engine",
  "social-media",
  "insights",
  "manager",
  "ad-monitor",
  "ad-manager",
] as const;
export type PackageSlug = (typeof PACKAGE_SLUGS)[number];

/** Bumped when a definition changes; stored on each install (decision 7). */
export const PACKAGE_CATALOG_VERSION = 1;

/** Card live-line keys (decision 12). */
export const PACKAGE_CARD_METRIC_KEYS = [
  "workflow.weekly_target",
  "posts.month_review",
  "report.last_run",
  "brief.last_run",
] as const;
export type PackageCardMetricKey = (typeof PACKAGE_CARD_METRIC_KEYS)[number];

/** Capabilities every company has; listed on the card, never connected. */
export const BUILT_IN_CONNECTORS = ["web_search", "company_memory"] as const;
export type BuiltInConnector = (typeof BUILT_IN_CONNECTORS)[number];

export type ConnectorRequirement = "required" | "optional" | "built_in";

export type PackageConnector =
  | { type: ConnectorCatalogType; requirement: "required" | "optional" }
  | { type: BuiltInConnector; requirement: "built_in" };

export type PackageAgentDefinition = {
  /** Stable reference used by workflows and schedules in this definition. */
  key: string;
  name: string;
  description: string;
  model: "haiku" | "sonnet" | "opus";
  toolToggles: ToolToggles;
  instructions: string;
};

export type PackageStageDefinition = {
  order: number;
  name: string;
  /** Null for an outcome stage such as Delivered to client. */
  agentKey: string | null;
  /** Key into the web metric-key catalog (`lib/workflows/metrics`). */
  metricKey: string;
};

export type PackageWorkflowDefinition = {
  name: string;
  flow: WorkflowFlow;
  position: number;
  weeklyTarget: number | null;
  targetMetricKey: string | null;
  /** `order` of the stage customer-agent leads enter through. */
  inboundStageOrder: number | null;
  intake: readonly WorkflowIntakeField[];
  stages: readonly PackageStageDefinition[];
};

/** One Schedule (cron job) per agent; time is in the company's timezone. */
export type PackageScheduleDefinition = {
  agentKey: string;
  name: string;
  prompt: string;
} & (
  | { scheduleKind: "daily"; timeOfDay: number }
  | { scheduleKind: "weekly"; weekday: number; timeOfDay: number }
);

export type PackageDefinition = {
  slug: PackageSlug;
  name: string;
  description: string;
  agents: readonly PackageAgentDefinition[];
  workflows: readonly PackageWorkflowDefinition[];
  schedules: readonly PackageScheduleDefinition[];
  connectors: readonly PackageConnector[];
  cardMetricKey: PackageCardMetricKey;
};

const NO_TOOLS: ToolToggles = {
  webSearch: false,
  excel: false,
  companyMemory: false,
  proposeAction: false,
};

export const PACKAGE_CATALOG: readonly PackageDefinition[] = [
  {
    slug: "lead-engine",
    name: "Lead engine",
    description:
      "Gather accounts that fit, qualify them with a fit score, and draft outreach a person approves before anything is sent.",
    agents: [
      {
        key: "gatherer",
        name: "Lead Gatherer",
        description: "Finds accounts that fit and adds them as gathered leads.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS, webSearch: true, companyMemory: true },
        instructions: LEAD_GATHERER_INSTRUCTIONS,
      },
      {
        key: "qualifier",
        name: "Lead Qualifier",
        description: "Scores gathered and inbound leads against the ideal customer.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS, webSearch: true, companyMemory: true },
        instructions: LEAD_QUALIFIER_INSTRUCTIONS,
      },
      {
        key: "mailer",
        name: "Mail Marketer",
        description: "Drafts outreach and follow-ups for qualified leads.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS, companyMemory: true, proposeAction: true },
        instructions: MAIL_MARKETER_INSTRUCTIONS,
      },
    ],
    workflows: [
      {
        name: "Lead engine",
        flow: "sequence",
        position: 0,
        weeklyTarget: 10,
        targetMetricKey: "leads.qualified_delivered",
        inboundStageOrder: 1,
        intake: LEAD_ENGINE_INTAKE,
        stages: [
          { order: 0, name: "Gather", agentKey: "gatherer", metricKey: "records.gathered" },
          { order: 1, name: "Qualify", agentKey: "qualifier", metricKey: "records.qualified" },
          { order: 2, name: "Outreach", agentKey: "mailer", metricKey: "records.contacted_replied" },
          { order: 3, name: "Delivered to client", agentKey: null, metricKey: "records.delivered" },
        ],
      },
    ],
    schedules: [
      { agentKey: "gatherer", name: "Gather leads", prompt: LEAD_GATHERER_PROMPT, scheduleKind: "daily", timeOfDay: 420 },
      { agentKey: "qualifier", name: "Qualify leads", prompt: LEAD_QUALIFIER_PROMPT, scheduleKind: "daily", timeOfDay: 450 },
      { agentKey: "mailer", name: "Outreach follow-up", prompt: MAIL_MARKETER_PROMPT, scheduleKind: "daily", timeOfDay: 480 },
    ],
    connectors: [
      { type: "google_places", requirement: "optional" },
      { type: "hunter", requirement: "optional" },
      { type: "snov", requirement: "optional" },
      { type: "google_workspace", requirement: "optional" },
      { type: "web_search", requirement: "built_in" },
      { type: "company_memory", requirement: "built_in" },
    ],
    cardMetricKey: "workflow.weekly_target",
  },
  {
    slug: "social-media",
    name: "Social media",
    description:
      "Keep the content calendar filled and answer reviews, with every post and reply approved by a person.",
    agents: [
      {
        key: "social",
        name: "Social Media Manager",
        description: "Plans posts and drafts review replies.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS, companyMemory: true },
        instructions: SOCIAL_MEDIA_MANAGER_INSTRUCTIONS,
      },
    ],
    workflows: [
      {
        name: "Social media",
        flow: "parallel",
        position: 1,
        weeklyTarget: null,
        targetMetricKey: null,
        inboundStageOrder: null,
        intake: [],
        stages: [
          { order: 0, name: "Content calendar", agentKey: "social", metricKey: "posts.scheduled_review" },
          { order: 1, name: "Review management", agentKey: "social", metricKey: "reviews.new_negative" },
        ],
      },
    ],
    schedules: [
      { agentKey: "social", name: "Content calendar", prompt: SOCIAL_CONTENT_PROMPT, scheduleKind: "weekly", weekday: 1, timeOfDay: 540 },
      { agentKey: "social", name: "Review check", prompt: SOCIAL_REVIEWS_PROMPT, scheduleKind: "daily", timeOfDay: 600 },
    ],
    connectors: [
      { type: "meta", requirement: "required" },
      { type: "google_business_profile", requirement: "required" },
      { type: "linkedin", requirement: "optional" },
      { type: "trustpilot", requirement: "optional" },
    ],
    cardMetricKey: "posts.month_review",
  },
  {
    slug: "insights",
    name: "Insights",
    description:
      "A weekly marketing analysis that writes the summary and highlights of the client report.",
    agents: [
      {
        key: "analyst",
        name: "Market Analyst",
        description: "Writes the client report's summary and highlights.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS, webSearch: true, companyMemory: true },
        instructions: MARKET_ANALYST_INSTRUCTIONS,
      },
    ],
    workflows: [
      {
        name: "Insights",
        flow: "sequence",
        position: 2,
        weeklyTarget: null,
        targetMetricKey: null,
        inboundStageOrder: null,
        intake: [],
        stages: [
          { order: 0, name: "Marketing analysis", agentKey: "analyst", metricKey: "report.next_run" },
        ],
      },
    ],
    schedules: [
      { agentKey: "analyst", name: "Weekly analysis", prompt: MARKET_ANALYST_PROMPT, scheduleKind: "weekly", weekday: 1, timeOfDay: 480 },
    ],
    connectors: [
      { type: "web_search", requirement: "built_in" },
      { type: "company_memory", requirement: "built_in" },
    ],
    cardMetricKey: "report.last_run",
  },
  {
    slug: "manager",
    name: "Daily manager",
    description:
      "A morning brief: what to do today, what to set up next, and what needs a decision.",
    agents: [
      {
        key: "manager",
        name: "Daily Manager",
        description: "Writes the morning brief.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS },
        instructions: DAILY_MANAGER_INSTRUCTIONS,
      },
    ],
    workflows: [
      {
        name: "Daily manager",
        flow: "sequence",
        position: 3,
        weeklyTarget: null,
        targetMetricKey: null,
        inboundStageOrder: null,
        intake: [],
        stages: [
          { order: 0, name: "Morning brief", agentKey: "manager", metricKey: "brief.last_run" },
        ],
      },
    ],
    schedules: [
      { agentKey: "manager", name: "Morning brief", prompt: DAILY_MANAGER_PROMPT, scheduleKind: "daily", timeOfDay: 510 },
    ],
    connectors: [{ type: "company_memory", requirement: "built_in" }],
    cardMetricKey: "brief.last_run",
  },
  {
    // RL7: reads a code-built ad state and writes the ad items of the morning
    // brief at 08:00, before the Daily manager's 08:30 run. Read only.
    slug: "ad-monitor",
    name: "Ad monitor",
    description:
      "A morning ad report: spend, leads and cost per lead per channel, data gaps, and actions that need a decision.",
    agents: [
      {
        key: "monitor",
        name: "Ad Monitor",
        description: "Writes the morning ad report.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS },
        instructions: AD_MONITOR_INSTRUCTIONS,
      },
    ],
    workflows: [],
    schedules: [
      { agentKey: "monitor", name: "Morning ad report", prompt: AD_MONITOR_PROMPT, scheduleKind: "daily", timeOfDay: 480 },
    ],
    connectors: [{ type: "company_memory", requirement: "built_in" }],
    cardMetricKey: "brief.last_run",
  },
  {
    // RL8b1: proposes ad changes through proposeAdChange, which decides in
    // code whether a change runs on its own (with an undo card), becomes an
    // ad_change approval card, or is refused at the daily cap. Its one daily
    // Schedule runs at 08:15, after the 08:00 Ad monitor report; package tools
    // reach the agent only through a package-installed Schedule.
    slug: "ad-manager",
    name: "Ad manager",
    description:
      "Proposes ad changes. Budget increases, copy and keywords wait for approval; safe reductions run on their own with a one-click undo card.",
    agents: [
      {
        key: "manager",
        name: "Ad Manager",
        description: "Reads the ad accounts and proposes changes.",
        model: "sonnet",
        toolToggles: { ...NO_TOOLS },
        instructions: AD_MANAGER_INSTRUCTIONS,
      },
    ],
    workflows: [],
    schedules: [
      { agentKey: "manager", name: "Morning ad check", prompt: AD_MANAGER_PROMPT, scheduleKind: "daily", timeOfDay: 495 },
    ],
    connectors: [{ type: "company_memory", requirement: "built_in" }],
    cardMetricKey: "brief.last_run",
  },
];

export function isPackageSlug(slug: string): slug is PackageSlug {
  return (PACKAGE_SLUGS as readonly string[]).includes(slug);
}

export function getPackageDefinition(slug: string): PackageDefinition | null {
  return PACKAGE_CATALOG.find((row) => row.slug === slug) ?? null;
}

/** Connectors whose absence pauses the package's Schedules (decision 6). */
export function requiredConnectorTypes(
  definition: PackageDefinition,
): ConnectorCatalogType[] {
  return definition.connectors.flatMap((c) =>
    c.requirement === "required" ? [c.type] : [],
  );
}

/** Required connectors not in `connected`, in catalog order. */
export function missingRequiredConnectors(
  definition: PackageDefinition,
  connected: Iterable<string>,
): ConnectorCatalogType[] {
  const have = new Set(connected);
  return requiredConnectorTypes(definition).filter((type) => !have.has(type));
}
