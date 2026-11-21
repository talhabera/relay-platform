import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type { ModelKey } from "@/lib/ai/model-keys";
import type {
  users,
  companies,
  agents,
  companyMembers,
  agentVersions,
  operatorAgentEditors,
  sessionFiles,
  cronJobs,
  cronRuns,
  cronRunMessages,
  companyRecords,
  checkpoints,
  channels,
  integrations,
  chats,
  messages,
  knowledgeBase,
  analyticsEvents,
  widgetConfigs,
  userPreferences,
  tokenUsage,
} from "@/db/schema";

// Select types (read from DB)
export type User = InferSelectModel<typeof users>;
export type Company = InferSelectModel<typeof companies>;
export type Agent = InferSelectModel<typeof agents>;
export type CompanyMember = InferSelectModel<typeof companyMembers>;
export type AgentVersion = InferSelectModel<typeof agentVersions>;
export type OperatorAgentEditor = InferSelectModel<typeof operatorAgentEditors>;
export type SessionFile = InferSelectModel<typeof sessionFiles>;
export type CronJob = InferSelectModel<typeof cronJobs>;
export type CronRun = InferSelectModel<typeof cronRuns>;
export type CronRunMessage = InferSelectModel<typeof cronRunMessages>;
export type CompanyRecord = InferSelectModel<typeof companyRecords>;
export type Checkpoint = InferSelectModel<typeof checkpoints>;
export type Channel = InferSelectModel<typeof channels>;
export type Integration = InferSelectModel<typeof integrations>;
export type Chat = InferSelectModel<typeof chats>;
export type Message = InferSelectModel<typeof messages>;
export type KnowledgeEntry = InferSelectModel<typeof knowledgeBase>;
export type AnalyticsEvent = InferSelectModel<typeof analyticsEvents>;
export type WidgetConfig = InferSelectModel<typeof widgetConfigs>;
export type UserPreference = InferSelectModel<typeof userPreferences>;
export type TokenUsage = InferSelectModel<typeof tokenUsage>;

// Insert types (write to DB)
export type NewUser = InferInsertModel<typeof users>;
export type NewCompany = InferInsertModel<typeof companies>;
export type NewAgent = InferInsertModel<typeof agents>;
export type NewCompanyMember = InferInsertModel<typeof companyMembers>;
export type NewAgentVersion = InferInsertModel<typeof agentVersions>;
export type NewOperatorAgentEditor = InferInsertModel<
  typeof operatorAgentEditors
>;
export type NewSessionFile = InferInsertModel<typeof sessionFiles>;
export type NewCronJob = InferInsertModel<typeof cronJobs>;
export type NewCronRun = InferInsertModel<typeof cronRuns>;
export type NewCronRunMessage = InferInsertModel<typeof cronRunMessages>;
export type NewCompanyRecord = InferInsertModel<typeof companyRecords>;
export type NewCheckpoint = InferInsertModel<typeof checkpoints>;
export type NewChannel = InferInsertModel<typeof channels>;
export type NewIntegration = InferInsertModel<typeof integrations>;
export type NewChat = InferInsertModel<typeof chats>;
export type NewMessage = InferInsertModel<typeof messages>;
export type NewKnowledgeEntry = InferInsertModel<typeof knowledgeBase>;
export type NewAnalyticsEvent = InferInsertModel<typeof analyticsEvents>;
export type NewWidgetConfig = InferInsertModel<typeof widgetConfigs>;
export type NewTokenUsage = InferInsertModel<typeof tokenUsage>;

// Enums
export type AgentKind = "customer" | "operator";
export type AgentPersona = "friendly" | "professional" | "casual" | "expert";
export type ResponseLength = "short" | "medium" | "long";
export type AgentLanguage = "en" | "es" | "fr" | "de" | "tr";
export type ChannelType =
  | "whatsapp"
  | "instagram"
  | "telegram"
  | "messenger"
  | "widget";
export type ChatChannelType = ChannelType | "web" | "operator" | "master";
export type AgentVersionStatus = "live" | "draft";
export type IntegrationType =
  | "slack"
  | "discord"
  | "zendesk"
  | "shopify"
  | "mcp_custom";
export type IntegrationStatus =
  | "connected"
  | "disconnected"
  | "pending"
  | "error";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type CronRunStatus =
  | "running"
  | "awaiting_input"
  | "succeeded"
  | "failed";
export type ScheduleKind = "interval" | "daily" | "weekly";
export type KnowledgeType = "file" | "website" | "api";
export type KnowledgeStatus = "processing" | "ready" | "error";
export type WebsiteMetadata = {
  title?: string;
  domain: string;
  wordCount: number;
  fetchedAt: string;
};
export type WidgetPosition = "bottom-right" | "bottom-left";
export type WidgetTheme = "light" | "dark" | "auto";
