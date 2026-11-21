import { and, count, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { agents, channels, chats, companies, integrations, leads, widgetConfigs } from "@/db/schema";

import { buildAgentsCanvas, type AgentsCanvasModel } from "./agents-canvas-model";
import type { AgentsWidget } from "./widget-config-model";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Customer agents of one company with their channels, chats this week and leads to qualify. */
export async function loadAgentsCanvas(
  companyId: string,
  selectedAgentId: string | undefined,
): Promise<AgentsCanvasModel> {
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      model: agents.model,
      isActive: agents.isActive,
      instructions: agents.instructions,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "customer")))
    .orderBy(agents.createdAt);

  const ids = agentRows.map((a) => a.id);
  const since = new Date(Date.now() - WEEK_MS);

  const [channelRows, chatRows, leadRows, integrationRows] =
    ids.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          db
            .select({ id: channels.id, agentId: channels.agentId, type: channels.type, status: channels.status })
            .from(channels)
            .where(inArray(channels.agentId, ids)),
          db
            .select({ agentId: chats.agentId, n: count() })
            .from(chats)
            .where(and(inArray(chats.agentId, ids), gte(chats.createdAt, since)))
            .groupBy(chats.agentId),
          db
            .select({ agentId: leads.agentId, n: count() })
            .from(leads)
            .where(and(inArray(leads.agentId, ids), eq(leads.status, "new")))
            .groupBy(leads.agentId),
          db
            .select({
              id: integrations.id,
              agentId: integrations.agentId,
              name: integrations.name,
              type: integrations.type,
              status: integrations.status,
            })
            .from(integrations)
            .where(eq(integrations.companyId, companyId))
            .orderBy(integrations.createdAt),
        ]);

  const counts = (rows: readonly { agentId: string | null; n: number }[]) =>
    new Map(rows.flatMap((r) => (r.agentId ? [[r.agentId, Number(r.n)] as const] : [])));

  return buildAgentsCanvas(
    {
      agents: agentRows.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: a.model,
        isActive: a.isActive ?? true,
        instructions: a.instructions,
        updatedAt: a.updatedAt,
      })),
      channels: channelRows.map((c) => ({ id: c.id, agentId: c.agentId, type: c.type, active: c.status !== "inactive" })),
      chatsThisWeek: counts(chatRows),
      leadsToQualify: counts(leadRows),
      integrations: integrationRows.map((i) => ({
        id: i.id,
        agentId: i.agentId,
        name: i.name,
        type: i.type,
        connected: i.status === "connected",
      })),
    },
    selectedAgentId,
  );
}

/** The company's Website widget for the inspector's widget dialog. */
export async function loadAgentsWidget(companyId: string): Promise<AgentsWidget | null> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name, widgetId: companies.widgetId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) return null;

  const [config] = await db
    .select({
      primaryColor: widgetConfigs.primaryColor,
      welcomeMessage: widgetConfigs.welcomeMessage,
      title: widgetConfigs.title,
      position: widgetConfigs.position,
      agentId: widgetConfigs.agentId,
      agentName: agents.name,
    })
    .from(widgetConfigs)
    .leftJoin(agents, eq(agents.id, widgetConfigs.agentId))
    .where(eq(widgetConfigs.companyId, companyId))
    .limit(1);

  return {
    companyId: company.id,
    companyName: company.name,
    widgetId: company.widgetId,
    config: config
      ? {
          primaryColor: config.primaryColor,
          welcomeMessage: config.welcomeMessage,
          title: config.title,
          position: config.position,
          agentId: config.agentId,
        }
      : null,
    agentName: config?.agentName ?? undefined,
  };
}
