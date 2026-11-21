import { createWorkflowsReader } from "@/lib/workflows";
import { dbMetricSource } from "./source";

export {
  campaignMetrics,
  campaignOf,
  getCampaignMetrics,
  loadCampaignLeads,
  loadQualifiedIds,
  type CampaignAttribution,
  type CampaignLeadFact,
  type CampaignMetric,
} from "./campaigns";

export {
  costPerQualifiedLead,
  countLeadMetrics,
  ESTIMATED_USD_PER_MILLION_TOKENS,
  firstDeliveredInRange,
  inRange,
  isGatheredEvent,
  isInboundEvent,
  LEAD_STATUS_BUCKETS,
  leadQualityScore,
  leadsPerAgent,
  type CostPerQualifiedLead,
  type LeadCounts,
  type LeadEventFact,
  type WeekRange,
} from "./compute";
export {
  CONVERSATION_CHANNEL_TYPES,
  dbMetricSource,
  getCanvasStats,
  getCompanyKpis,
  loadCompanyTokens,
  loadCompanyWeek,
  loadLeadFacts,
  type AgentWeekStats,
  type CanvasStats,
  type CompanyKpis,
  type CompanyWeek,
} from "./source";
export {
  MAX_WEEKLY_TARGET,
  setWeeklyTarget,
  WeeklyTargetError,
  weeklyTargetSchema,
  type WeeklyTargetInput,
} from "./target";

/** Workflows with live stage metrics and target progress (S11 reader + S23 source). */
export const workflowsReader = createWorkflowsReader({ metrics: dbMetricSource });
