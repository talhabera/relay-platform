import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
export * from "./schema";
export {
  INTERVAL_MINUTES,
  type CronSchedule,
  type IntervalMinutes,
  isValidTimeZone,
  computeNextFireAt,
} from "./cron-schedule";
export {
  FIT_SCORE_MIN,
  FIT_SCORE_MAX,
  FIT_SCORE_QUALIFIED,
  FIT_SCORE_BORDERLINE,
  LEAD_BANDS,
  fitScoreBand,
  isValidFitScore,
  DELIVERABLE_LEAD_STATUSES,
  isDeliverableLeadStatus,
  type LeadBand,
} from "./lead-scoring";
export {
  LEAD_ENGINE_INTAKE,
  LEGACY_INBOUND_INTAKE,
  LEAD_KOD_KEY,
  effectiveIntake,
  missingIntakeFields,
  isIntakeComplete,
  toE164,
} from "./lead-intake";
export {
  AD_CURRENCY,
  AD_CHANNELS,
  AD_CODE_PREFIX,
  CLICK_TTL_DAYS,
  META_FIXED_CODE_PATTERN,
  isValidAdCode,
  ipSubject,
  bindClickToRecord,
} from "./ad-click";
export type {
  AdChannel,
  AdClickExecutor,
  BindClickToRecordInput,
} from "./ad-click";
export { isResearchFresh } from "./packages/research-fresh";
export type { SendOutreachSnapshot } from "./schema/checkpoints";
export {
  PACKAGE_CATALOG,
  PACKAGE_CATALOG_VERSION,
  PACKAGE_SLUGS,
  PACKAGE_CARD_METRIC_KEYS,
  BUILT_IN_CONNECTORS,
  getPackageDefinition,
  isPackageSlug,
  requiredConnectorTypes,
  missingRequiredConnectors,
} from "./packages/catalog";
export type {
  PackageSlug,
  PackageDefinition,
  PackageAgentDefinition,
  PackageWorkflowDefinition,
  PackageStageDefinition,
  PackageScheduleDefinition,
  PackageConnector,
  PackageCardMetricKey,
  BuiltInConnector,
  ConnectorRequirement,
} from "./packages/catalog";
export {
  OPERATOR_CONNECTOR_TYPES,
  OAUTH_CONNECTOR_TYPES,
  UNAVAILABLE_CONNECTOR_TYPES,
  CONNECTOR_CATALOG_TYPES,
  isOperatorConnectorType,
  isOAuthConnectorType,
  isConnectorCatalogType,
  isConnectorAvailable,
} from "./connectors/types";
export type {
  OperatorConnectorType,
  OAuthConnectorType,
  AvailableConnectorType,
  UnavailableConnectorType,
  ConnectorCatalogType,
} from "./connectors/types";
export {
  OPEN_CHECKPOINT_STATUSES,
  isOpenCheckpointStatus,
  deriveSessionStatus,
  checkpointArtifactHash,
} from "./checkpoint-state";
export {
  insertLeadEvent,
  transitionLeadStatus,
  recordFallbackActor,
  leadEventActorColumns,
  LeadEventActorError,
} from "./lead-events";
export type {
  LeadEventRow,
  LeadEventActor,
  LeadEventExecutor,
  InsertLeadEventInput,
  TransitionLeadStatusInput,
  TransitionLeadStatusResult,
} from "./lead-events";
export {
  IMMATURE_DAYS,
  STOP_RULE_DAY,
  LOW_DATA_LEADS,
  NO_LEAD_WARNING_DAYS,
  SUSPICIOUS_DROP_RATIO,
  MAX_AD_BRIEF_ITEMS,
  RECENT_MATURE_DAYS,
  addDaysLabel,
  daysBetween,
  dayLabels,
  matureThrough,
  isMature,
  formatTryMinor,
  liveChannels,
  evaluateAdState,
  checkSpendBatch,
} from "./ad-monitor";
export type {
  AdMonitorSettings,
  AdSpendDayRow,
  AdChannelInput,
  AdMonitorInput,
  AdAlert,
  AdActionProposal,
  AdStopStatus,
  AdChannelState,
  AdState,
  SpendBatchRow,
  SpendBatch,
  StoredSpendRow,
  SpendBatchRefusal,
  SpendBatchCheck,
} from "./ad-monitor";
export {
  AD_PLATFORMS,
  AD_CHANGE_ACTIONS,
  AD_CHANGE_PHASES,
  AD_CHANGE_OUTCOMES,
  AD_CHANGE_OUTCOME_CODES,
  AD_CHANGE_ACTOR_TYPES,
  AD_KEYWORD_MATCH_TYPES,
  RESERVATION_TTL_MS,
  AD_CHANGE_CARD_TTL_MS,
  AD_CHANGE_DETAIL_MAX,
  budgetDelta,
  checkCap,
  adChangeReasonSchema,
  decideAutonomy,
} from "./ad-change";
export type {
  AdPlatform,
  AdChangeAction,
  AdChangePhase,
  AdChangeOutcome,
  AdChangeOutcomeCode,
  AdChangeActorType,
  AdKeywordMatchType,
  AdCampaignObserved,
  AdChangeCommand,
  AdCampaignBudget,
  CheckCapInput,
  CheckCapResult,
  AdChangeReason,
  AdChangeReasonValidator,
  DecideAutonomyInput,
  AutonomyDecision,
} from "./ad-change";
