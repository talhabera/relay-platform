import { db } from "@/db";
import {
  analyticsEvents,
  agents,
  chats,
  messages,
} from "@/db/schema";
import { eq, and, gte, lte, count, sql, desc } from "drizzle-orm";

export type AnalyticsSummary = {
  totalEvents: number;
  totalChats: number;
  totalMessages: number;
  activeAgents: number;
  eventsByType: Record<string, number>;
  eventsByAgent: Record<string, number>;
  eventsByIntegration: Record<string, number>;
};

export type MessagesOverTimeEntry = {
  date: string;
  count: number;
};

export type AgentPerformanceEntry = {
  agentId: string;
  agentName: string;
  messageCount: number;
  chatCount: number;
};

export type ChannelDistributionEntry = {
  channelType: string;
  count: number;
};

/**
 * Get a summary of analytics for a company within a date range.
 */
export async function getAnalyticsSummary(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<AnalyticsSummary> {
  // Total events
  const [eventsResult] = await db
    .select({ value: count() })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.companyId, companyId),
        gte(analyticsEvents.timestamp, startDate),
        lte(analyticsEvents.timestamp, endDate)
      )
    );

  // Total chats
  const [chatsResult] = await db
    .select({ value: count() })
    .from(chats)
    .where(
      and(
        eq(chats.companyId, companyId),
        gte(chats.createdAt, startDate),
        lte(chats.createdAt, endDate)
      )
    );

  // Total messages via subquery
  const [messagesResult] = await db
    .select({ value: count() })
    .from(messages)
    .where(
      and(
        sql`${messages.chatId} IN (SELECT id FROM chats WHERE company_id = ${companyId})`,
        gte(messages.createdAt, startDate),
        lte(messages.createdAt, endDate)
      )
    );

  // Active agents (agents that have chats in the period)
  const activeAgentsResult = await db
    .selectDistinct({ agentId: chats.agentId })
    .from(chats)
    .where(
      and(
        eq(chats.companyId, companyId),
        gte(chats.createdAt, startDate),
        lte(chats.createdAt, endDate),
        sql`${chats.agentId} IS NOT NULL`
      )
    );

  // Events by type
  const eventsByTypeRows = await db
    .select({
      event: analyticsEvents.event,
      value: count(),
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.companyId, companyId),
        gte(analyticsEvents.timestamp, startDate),
        lte(analyticsEvents.timestamp, endDate)
      )
    )
    .groupBy(analyticsEvents.event);

  const eventsByType: Record<string, number> = {};
  for (const row of eventsByTypeRows) {
    eventsByType[row.event] = row.value;
  }

  // Events by agent
  const eventsByAgentRows = await db
    .select({
      agentId: analyticsEvents.agentId,
      agentName: agents.name,
      value: count(),
    })
    .from(analyticsEvents)
    .leftJoin(agents, eq(analyticsEvents.agentId, agents.id))
    .where(
      and(
        eq(analyticsEvents.companyId, companyId),
        gte(analyticsEvents.timestamp, startDate),
        lte(analyticsEvents.timestamp, endDate),
        sql`${analyticsEvents.agentId} IS NOT NULL`
      )
    )
    .groupBy(analyticsEvents.agentId, agents.name);

  const eventsByAgent: Record<string, number> = {};
  for (const row of eventsByAgentRows) {
    const name = row.agentName ?? row.agentId ?? "Unknown";
    eventsByAgent[name] = row.value;
  }

  // Events by integration type
  const eventsByIntegrationRows = await db
    .select({
      integrationType: analyticsEvents.integrationType,
      value: count(),
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.companyId, companyId),
        gte(analyticsEvents.timestamp, startDate),
        lte(analyticsEvents.timestamp, endDate),
        sql`${analyticsEvents.integrationType} IS NOT NULL`
      )
    )
    .groupBy(analyticsEvents.integrationType);

  const eventsByIntegration: Record<string, number> = {};
  for (const row of eventsByIntegrationRows) {
    if (row.integrationType) {
      eventsByIntegration[row.integrationType] = row.value;
    }
  }

  return {
    totalEvents: eventsResult?.value ?? 0,
    totalChats: chatsResult?.value ?? 0,
    totalMessages: messagesResult?.value ?? 0,
    activeAgents: activeAgentsResult.length,
    eventsByType,
    eventsByAgent,
    eventsByIntegration,
  };
}

/**
 * Get message counts grouped by day or week over a date range.
 */
export async function getMessagesOverTime(
  companyId: string,
  startDate: Date,
  endDate: Date,
  interval: "day" | "week" = "day"
): Promise<MessagesOverTimeEntry[]> {
  const truncFn =
    interval === "week"
      ? sql`date_trunc('week', ${messages.createdAt})`
      : sql`date_trunc('day', ${messages.createdAt})`;

  const rows = await db
    .select({
      date: truncFn.as("date"),
      count: count(),
    })
    .from(messages)
    .where(
      and(
        sql`${messages.chatId} IN (SELECT id FROM chats WHERE company_id = ${companyId})`,
        gte(messages.createdAt, startDate),
        lte(messages.createdAt, endDate)
      )
    )
    .groupBy(truncFn)
    .orderBy(truncFn);

  return rows.map((row) => ({
    date:
      row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date).split("T")[0],
    count: row.count,
  }));
}

/**
 * Get agent performance (message and chat counts) for a company.
 */
export async function getAgentPerformance(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<AgentPerformanceEntry[]> {
  // Chat counts per agent
  const chatCountRows = await db
    .select({
      agentId: chats.agentId,
      agentName: agents.name,
      chatCount: count(),
    })
    .from(chats)
    .innerJoin(agents, eq(chats.agentId, agents.id))
    .where(
      and(
        eq(chats.companyId, companyId),
        gte(chats.createdAt, startDate),
        lte(chats.createdAt, endDate),
        sql`${chats.agentId} IS NOT NULL`
      )
    )
    .groupBy(chats.agentId, agents.name);

  // Message counts per agent (via chats)
  const messageCountRows = await db
    .select({
      agentId: chats.agentId,
      messageCount: count(),
    })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.companyId, companyId),
        gte(messages.createdAt, startDate),
        lte(messages.createdAt, endDate),
        sql`${chats.agentId} IS NOT NULL`
      )
    )
    .groupBy(chats.agentId);

  // Merge chat and message counts
  const messageMap = new Map<string, number>();
  for (const row of messageCountRows) {
    if (row.agentId) {
      messageMap.set(row.agentId, row.messageCount);
    }
  }

  return chatCountRows.map((row) => ({
    agentId: row.agentId!,
    agentName: row.agentName,
    messageCount: messageMap.get(row.agentId!) ?? 0,
    chatCount: row.chatCount,
  }));
}

/**
 * Get the distribution of chats across channel types for a company.
 */
export async function getChannelDistribution(
  companyId: string
): Promise<ChannelDistributionEntry[]> {
  const rows = await db
    .select({
      channelType: chats.channelType,
      count: count(),
    })
    .from(chats)
    .where(eq(chats.companyId, companyId))
    .groupBy(chats.channelType)
    .orderBy(desc(count()));

  return rows.map((row) => ({
    channelType: row.channelType ?? "unknown",
    count: row.count,
  }));
}
