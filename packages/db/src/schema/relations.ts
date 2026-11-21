import { relations } from "drizzle-orm";
import { users } from "./users";
import { companies, widgetConfigs, userPreferences } from "./companies";
import { agents } from "./agents";
import { companyMembers } from "./company-members";
import { agentVersions } from "./agent-versions";
import { operatorAgentEditors } from "./operator-agent-editors";
import { cronJobs } from "./cron-jobs";
import { cronRuns } from "./cron-runs";
import { cronRunMessages } from "./cron-run-messages";
import { sessionFiles } from "./session-files";
import { companyRecords } from "./company-records";
import { checkpoints } from "./checkpoints";
import { agentQuestions } from "./agent-questions";
import { channels } from "./channels";
import { instagramComments } from "./instagram-comments";
import { integrations } from "./integrations";
import { chats } from "./chats";
import { messages } from "./messages";
import { knowledgeBase } from "./knowledge-base";
import { analyticsEvents } from "./analytics";
import { portalEvents } from "./portal-events";
import { leads } from "./leads";
import { agentHandoffSettings, handoffRequests } from "./handoff";
import { workflows, workflowStages } from "./workflows";
import { dailyBriefs } from "./daily-briefs";
import { projects } from "./projects";
import { tasks } from "./tasks";

// Users
export const usersRelations = relations(users, ({ many, one }) => ({
  companies: many(companies),
  chats: many(chats),
  preferences: one(userPreferences),
  companyMemberships: many(companyMembers),
}));

// Companies
export const companiesRelations = relations(companies, ({ one, many }) => ({
  owner: one(users, { fields: [companies.ownerId], references: [users.id] }),
  widgetConfig: one(widgetConfigs),
  agents: many(agents),
  integrations: many(integrations),
  chats: many(chats),
  analyticsEvents: many(analyticsEvents),
  knowledgeBase: many(knowledgeBase),
  members: many(companyMembers),
  cronJobs: many(cronJobs),
  companyRecords: many(companyRecords),
  dailyBriefs: many(dailyBriefs),
  projects: many(projects),
  tasks: many(tasks),
}));

export const widgetConfigsRelations = relations(widgetConfigs, ({ one }) => ({
  company: one(companies, {
    fields: [widgetConfigs.companyId],
    references: [companies.id],
  }),
}));

export const userPreferencesRelations = relations(
  userPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userPreferences.userId],
      references: [users.id],
    }),
    activeCompany: one(companies, {
      fields: [userPreferences.activeCompanyId],
      references: [companies.id],
    }),
  })
);

// Agents
export const agentsRelations = relations(agents, ({ one, many }) => ({
  company: one(companies, {
    fields: [agents.companyId],
    references: [companies.id],
  }),
  createdBy: one(users, {
    fields: [agents.createdByUserId],
    references: [users.id],
  }),
  channels: many(channels),
  integrations: many(integrations),
  knowledgeBase: many(knowledgeBase),
  chats: many(chats),
  analyticsEvents: many(analyticsEvents),
  versions: many(agentVersions),
  editors: many(operatorAgentEditors),
  cronJobs: many(cronJobs),
  sourcedRecords: many(companyRecords),
  checkpoints: many(checkpoints),
  agentQuestions: many(agentQuestions),
  handoffSettings: one(agentHandoffSettings),
  handoffRequests: many(handoffRequests),
  workflowStages: many(workflowStages),
  dailyBriefs: many(dailyBriefs),
}));

// Channels
export const channelsRelations = relations(channels, ({ one }) => ({
  agent: one(agents, {
    fields: [channels.agentId],
    references: [agents.id],
  }),
}));

// Instagram Comments
export const instagramCommentsRelations = relations(
  instagramComments,
  ({ one }) => ({
    channel: one(channels, {
      fields: [instagramComments.channelId],
      references: [channels.id],
    }),
    agent: one(agents, {
      fields: [instagramComments.agentId],
      references: [agents.id],
    }),
  })
);

// Integrations
export const integrationsRelations = relations(integrations, ({ one }) => ({
  company: one(companies, {
    fields: [integrations.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [integrations.agentId],
    references: [agents.id],
  }),
}));

// Chats
export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, { fields: [chats.userId], references: [users.id] }),
  company: one(companies, {
    fields: [chats.companyId],
    references: [companies.id],
  }),
  agent: one(agents, { fields: [chats.agentId], references: [agents.id] }),
  version: one(agentVersions, {
    fields: [chats.versionId],
    references: [agentVersions.id],
  }),
  messages: many(messages),
  checkpoints: many(checkpoints),
  agentQuestions: many(agentQuestions),
  sessionFiles: many(sessionFiles),
  handoffRequests: many(handoffRequests),
}));

// Messages
export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
}));

// Knowledge Base
export const knowledgeBaseRelations = relations(knowledgeBase, ({ one }) => ({
  agent: one(agents, {
    fields: [knowledgeBase.agentId],
    references: [agents.id],
  }),
  company: one(companies, {
    fields: [knowledgeBase.companyId],
    references: [companies.id],
  }),
}));

// Analytics
export const analyticsEventsRelations = relations(
  analyticsEvents,
  ({ one }) => ({
    company: one(companies, {
      fields: [analyticsEvents.companyId],
      references: [companies.id],
    }),
    agent: one(agents, {
      fields: [analyticsEvents.agentId],
      references: [agents.id],
    }),
  })
);

export const companyMembersRelations = relations(companyMembers, ({ one }) => ({
  company: one(companies, {
    fields: [companyMembers.companyId],
    references: [companies.id],
  }),
  user: one(users, {
    fields: [companyMembers.userId],
    references: [users.id],
  }),
}));

export const agentVersionsRelations = relations(
  agentVersions,
  ({ one, many }) => ({
    agent: one(agents, {
      fields: [agentVersions.agentId],
      references: [agents.id],
    }),
    parent: one(agentVersions, {
      fields: [agentVersions.parentVersionId],
      references: [agentVersions.id],
      relationName: "parentVersion",
    }),
    chats: many(chats),
    cronJobs: many(cronJobs),
  })
);

export const operatorAgentEditorsRelations = relations(
  operatorAgentEditors,
  ({ one }) => ({
    agent: one(agents, {
      fields: [operatorAgentEditors.agentId],
      references: [agents.id],
    }),
    user: one(users, {
      fields: [operatorAgentEditors.userId],
      references: [users.id],
    }),
    grantedBy: one(users, {
      fields: [operatorAgentEditors.grantedByUserId],
      references: [users.id],
    }),
  })
);

export const sessionFilesRelations = relations(sessionFiles, ({ one }) => ({
  chat: one(chats, {
    fields: [sessionFiles.chatId],
    references: [chats.id],
  }),
  cronRun: one(cronRuns, {
    fields: [sessionFiles.cronRunId],
    references: [cronRuns.id],
  }),
}));

export const cronJobsRelations = relations(cronJobs, ({ one, many }) => ({
  company: one(companies, {
    fields: [cronJobs.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [cronJobs.agentId],
    references: [agents.id],
  }),
  version: one(agentVersions, {
    fields: [cronJobs.versionId],
    references: [agentVersions.id],
  }),
  createdBy: one(users, {
    fields: [cronJobs.createdByUserId],
    references: [users.id],
  }),
  runs: many(cronRuns),
}));

export const cronRunsRelations = relations(cronRuns, ({ one, many }) => ({
  job: one(cronJobs, {
    fields: [cronRuns.jobId],
    references: [cronJobs.id],
  }),
  messages: many(cronRunMessages),
  checkpoints: many(checkpoints),
  agentQuestions: many(agentQuestions),
  sessionFiles: many(sessionFiles),
  dailyBriefs: many(dailyBriefs),
}));

export const cronRunMessagesRelations = relations(
  cronRunMessages,
  ({ one }) => ({
    run: one(cronRuns, {
      fields: [cronRunMessages.runId],
      references: [cronRuns.id],
    }),
  })
);

export const companyRecordsRelations = relations(
  companyRecords,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [companyRecords.companyId],
      references: [companies.id],
    }),
    sourceAgent: one(agents, {
      fields: [companyRecords.sourceAgentId],
      references: [agents.id],
    }),
    checkpoints: many(checkpoints),
  }),
);

export const checkpointsRelations = relations(checkpoints, ({ one }) => ({
  company: one(companies, {
    fields: [checkpoints.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [checkpoints.agentId],
    references: [agents.id],
  }),
  chat: one(chats, {
    fields: [checkpoints.chatId],
    references: [chats.id],
  }),
  cronRun: one(cronRuns, {
    fields: [checkpoints.cronRunId],
    references: [cronRuns.id],
  }),
  record: one(companyRecords, {
    fields: [checkpoints.recordId],
    references: [companyRecords.id],
  }),
  resolvedBy: one(users, {
    fields: [checkpoints.resolvedByUserId],
    references: [users.id],
  }),
}));

export const agentQuestionsRelations = relations(
  agentQuestions,
  ({ one }) => ({
    company: one(companies, {
      fields: [agentQuestions.companyId],
      references: [companies.id],
    }),
    agent: one(agents, {
      fields: [agentQuestions.agentId],
      references: [agents.id],
    }),
    chat: one(chats, {
      fields: [agentQuestions.chatId],
      references: [chats.id],
    }),
    cronRun: one(cronRuns, {
      fields: [agentQuestions.cronRunId],
      references: [cronRuns.id],
    }),
    answeredBy: one(users, {
      fields: [agentQuestions.answeredByUserId],
      references: [users.id],
    }),
  }),
);

export const leadsRelations = relations(leads, ({ one }) => ({
  company: one(companies, {
    fields: [leads.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [leads.agentId],
    references: [agents.id],
  }),
  chat: one(chats, {
    fields: [leads.chatId],
    references: [chats.id],
  }),
}));

export const agentHandoffSettingsRelations = relations(
  agentHandoffSettings,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentHandoffSettings.agentId],
      references: [agents.id],
    }),
    company: one(companies, {
      fields: [agentHandoffSettings.companyId],
      references: [companies.id],
    }),
  }),
);

export const handoffRequestsRelations = relations(handoffRequests, ({ one }) => ({
  company: one(companies, {
    fields: [handoffRequests.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [handoffRequests.agentId],
    references: [agents.id],
  }),
  chat: one(chats, {
    fields: [handoffRequests.chatId],
    references: [chats.id],
  }),
}));

// Workflows
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  company: one(companies, {
    fields: [workflows.companyId],
    references: [companies.id],
  }),
  stages: many(workflowStages, { relationName: "workflowStages" }),
  inboundStage: one(workflowStages, {
    fields: [workflows.inboundStageId],
    references: [workflowStages.id],
    relationName: "workflowInboundStage",
  }),
}));

export const workflowStagesRelations = relations(workflowStages, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowStages.workflowId],
    references: [workflows.id],
    relationName: "workflowStages",
  }),
  agent: one(agents, {
    fields: [workflowStages.agentId],
    references: [agents.id],
  }),
}));

export const portalEventsRelations = relations(portalEvents, ({ one }) => ({
  company: one(companies, {
    fields: [portalEvents.companyId],
    references: [companies.id],
  }),
}));

export const dailyBriefsRelations = relations(dailyBriefs, ({ one }) => ({
  company: one(companies, {
    fields: [dailyBriefs.companyId],
    references: [companies.id],
  }),
  agent: one(agents, {
    fields: [dailyBriefs.agentId],
    references: [agents.id],
  }),
  cronRun: one(cronRuns, {
    fields: [dailyBriefs.cronRunId],
    references: [cronRuns.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  company: one(companies, {
    fields: [projects.companyId],
    references: [companies.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  company: one(companies, {
    fields: [tasks.companyId],
    references: [companies.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeUserId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [tasks.createdByUserId],
    references: [users.id],
  }),
  brief: one(dailyBriefs, {
    fields: [tasks.briefId],
    references: [dailyBriefs.id],
  }),
}));
