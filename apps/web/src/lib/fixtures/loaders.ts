// Fixture implementations of the read interfaces. Pure over a dataset, so
// tests and S97 can pass their own. Derivations (edges, target progress,
// stage pending, approvers, tile visibility) follow the specs, so a screen
// built on fixtures behaves the same once the real readers land.

import type { PagePermissions } from "@relay/db/schema";
import {
  buildNeedsYou,
  type NeedsYouCandidate,
} from "@/lib/operator/needs-you";
import {
  FIT_SCORE_BORDERLINE,
  FIT_SCORE_QUALIFIED,
  type AgentRef,
  type HandoffRequestView,
  type HomeTileConfig,
  type HomeTileVisibility,
  type HomeViewer,
  type IntakeField,
  type LeadBand,
  type LeadEvent,
  type LeadView,
  type MembershipRole,
  type MetricKey,
  type PortalEvent,
  type RelayReaders,
  type ReportSnapshot,
  type StageState,
  type WorkflowFlow,
  type WorkflowView,
} from "./interfaces";

export type FixtureData = {
  companies: { id: string; name: string; ownerId: string; timezone: string }[];
  users: { id: string; name: string; email: string }[];
  members: {
    companyId: string;
    userId: string;
    role: MembershipRole;
    pagePermissions: PagePermissions;
  }[];
  agents: {
    id: string;
    companyId: string;
    name: string;
    kind: "operator" | "customer";
    createdByUserId: string | null;
  }[];
  agentUsers: {
    agentId: string;
    userId: string;
    canEdit: boolean;
    canApprove: boolean;
  }[];
  workflows: {
    id: string;
    companyId: string;
    packageSlug: string;
    name: string;
    flow: WorkflowFlow;
    position: number;
    weeklyTarget: number | null;
    targetMetricKey: MetricKey | null;
    inboundStageId: string | null;
    intake: IntakeField[];
    stages: {
      id: string;
      order: number;
      name: string;
      agentId: string | null;
      metricKey: MetricKey;
      /** Run state; `needs_you` is derived from Needs you items. */
      state: Exclude<StageState, "needs_you">;
    }[];
  }[];
  inbound: {
    workflowId: string;
    leads: number;
    conversations: number;
    customerAgentIds: string[];
  }[];
  metricValues: {
    companyId: string;
    values: Partial<Record<MetricKey, number>>;
  }[];
  needsYou: (NeedsYouCandidate & { companyId: string })[];
  handoffRequests: HandoffRequestView[];
  leads: Omit<LeadView, "band">[];
  leadEvents: LeadEvent[];
  reportSnapshots: ReportSnapshot[];
  portalEvents: PortalEvent[];
  homeTiles: { companyId: string; tiles: HomeTileConfig[] }[];
};

/** Fixed bands, lead-scoring spec decision 2. */
export function fitScoreBand(score: number | null): LeadBand | null {
  if (score === null) return null;
  if (score >= FIT_SCORE_QUALIFIED) return "qualified";
  if (score >= FIT_SCORE_BORDERLINE) return "borderline";
  return "rejected";
}

/** Target metric counts leads: a "lead workflow" (needs-you-ordering spec 1). */
function isLeadMetric(key: MetricKey | null): boolean {
  return key !== null && (key.startsWith("leads.") || key.startsWith("records."));
}

function tileVisibleTo(v: HomeTileVisibility, viewer: HomeViewer): boolean {
  if (viewer.isOwner) return true;
  switch (v.kind) {
    case "everyone":
      return true;
    case "owners_only":
      return false;
    case "requires":
      return viewer.pagePermissions[v.permission];
  }
}

const byStartDesc = (a: { start: Date }, b: { start: Date }) =>
  b.start.getTime() - a.start.getTime();

export function createFixtureReaders(data: FixtureData): RelayReaders {
  const agentRef = (id: string | null): AgentRef | null => {
    const a = id ? data.agents.find((x) => x.id === id) : undefined;
    return a ? { id: a.id, name: a.name } : null;
  };
  const companyOf = (id: string) => data.companies.find((c) => c.id === id);
  const agentOf = (id: string) => data.agents.find((a) => a.id === id);
  const memberOf = (companyId: string, userId: string) =>
    data.members.find((m) => m.companyId === companyId && m.userId === userId);

  const isLeadWorkflowAgent = (agentId: string) =>
    data.workflows.some(
      (w) =>
        isLeadMetric(w.targetMetricKey) &&
        w.stages.some((s) => s.agentId === agentId),
    );

  /** Approve rights spec decision 2. */
  const canApprove = (agentId: string, userId: string): boolean => {
    const agent = agentOf(agentId);
    if (!agent) return false;
    if (companyOf(agent.companyId)?.ownerId === userId) return true;
    if (agent.createdByUserId === userId) return true;
    const m = memberOf(agent.companyId, userId);
    if (!m || m.role !== "member" || !m.pagePermissions.operator) return false;
    return data.agentUsers.some(
      (u) => u.agentId === agentId && u.userId === userId && u.canApprove,
    );
  };

  const homeTilesOf = (companyId: string): HomeTileConfig[] =>
    [...(data.homeTiles.find((t) => t.companyId === companyId)?.tiles ?? [])].sort(
      (a, b) => a.order - b.order,
    );

  const candidatesFor = (companyId: string) =>
    data.needsYou.filter((c) => c.companyId === companyId);

  return {
    workflows: {
      async listWorkflows(companyId) {
        const metrics =
          data.metricValues.find((m) => m.companyId === companyId)?.values ?? {};
        const candidates = candidatesFor(companyId);
        return data.workflows
          .filter((w) => w.companyId === companyId)
          .sort((a, b) => a.position - b.position)
          .map((w): WorkflowView => {
            const stages = [...w.stages]
              .sort((a, b) => a.order - b.order)
              .map((s) => {
                const pending = s.agentId
                  ? candidates.filter((c) => c.agentId === s.agentId).length
                  : 0;
                return {
                  id: s.id,
                  order: s.order,
                  name: s.name,
                  agent: agentRef(s.agentId),
                  metricKey: s.metricKey,
                  metricValue: metrics[s.metricKey] ?? null,
                  pending,
                  state: pending > 0 ? ("needs_you" as const) : s.state,
                };
              });
            const edges =
              w.flow === "sequence"
                ? stages.slice(1).map((s, i) => ({
                    fromStageId: stages[i].id,
                    toStageId: s.id,
                  }))
                : [];
            const inboundRow = data.inbound.find((i) => i.workflowId === w.id);
            const inbound =
              w.inboundStageId && inboundRow
                ? {
                    stageId: w.inboundStageId,
                    leads: inboundRow.leads,
                    conversations: inboundRow.conversations,
                    customerAgents: inboundRow.customerAgentIds
                      .map(agentRef)
                      .filter((a): a is AgentRef => a !== null),
                  }
                : null;
            const target =
              w.weeklyTarget !== null && w.targetMetricKey !== null
                ? {
                    weeklyTarget: w.weeklyTarget,
                    metricKey: w.targetMetricKey,
                    value: metrics[w.targetMetricKey] ?? 0,
                  }
                : null;
            return {
              id: w.id,
              companyId: w.companyId,
              packageSlug: w.packageSlug,
              name: w.name,
              flow: w.flow,
              position: w.position,
              stages,
              edges,
              inbound,
              target,
              intake: w.intake,
            };
          });
      },
    },

    needsYou: {
      async getNeedsYou(companyId, viewerUserId) {
        return buildNeedsYou({
          candidates: candidatesFor(companyId),
          isLeadWorkflowAgent,
          canApproveCheckpoint: (item) => canApprove(item.agentId, viewerUserId),
        });
      },
    },

    handoff: {
      async listHandoffRequests(companyId, filter) {
        return data.handoffRequests
          .filter(
            (r) =>
              r.companyId === companyId &&
              (!filter?.status || filter.status.includes(r.status)),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },

    access: {
      async getAccessRole(companyId, userId) {
        if (companyOf(companyId)?.ownerId === userId) return "owner";
        return memberOf(companyId, userId)?.role ?? null;
      },
      async listAgentUsers(agentId) {
        const agent = agentOf(agentId);
        if (!agent) return [];
        const rows = data.agentUsers.filter((u) => u.agentId === agentId);
        const ids = new Set(rows.map((u) => u.userId));
        if (agent.createdByUserId) ids.add(agent.createdByUserId);
        return [...ids].flatMap((userId) => {
          const user = data.users.find((u) => u.id === userId);
          if (!user) return [];
          const isCreator = agent.createdByUserId === userId;
          const row = rows.find((u) => u.userId === userId);
          return [
            {
              userId,
              name: user.name,
              email: user.email,
              isCreator,
              canEdit: isCreator || (row?.canEdit ?? false),
              canApprove: canApprove(agentId, userId),
            },
          ];
        });
      },
      async listApprovers(agentId) {
        const agent = agentOf(agentId);
        if (!agent) return [];
        const owner = companyOf(agent.companyId)?.ownerId;
        const ids = new Set<string>(owner ? [owner] : []);
        if (agent.createdByUserId) ids.add(agent.createdByUserId);
        for (const u of data.agentUsers) {
          if (u.agentId === agentId && canApprove(agentId, u.userId)) {
            ids.add(u.userId);
          }
        }
        return [...ids].flatMap((id) => {
          const user = data.users.find((u) => u.id === id);
          return user ? [{ id, name: user.name }] : [];
        });
      },
    },

    leads: {
      async listLeads(companyId, filter) {
        return data.leads
          .filter((l) => l.companyId === companyId)
          .map((l): LeadView => ({ ...l, band: fitScoreBand(l.fitScore) }))
          .filter(
            (l) =>
              (!filter?.band || l.band === filter.band) &&
              (!filter?.source || l.source === filter.source),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async listLeadEvents(companyId, { from, to }) {
        return data.leadEvents
          .filter(
            (e) =>
              e.companyId === companyId &&
              e.at.getTime() >= from.getTime() &&
              e.at.getTime() < to.getTime(),
          )
          .sort((a, b) => a.at.getTime() - b.at.getTime());
      },
    },

    reports: {
      async listReportSnapshots(companyId, period) {
        return data.reportSnapshots
          .filter((s) => s.companyId === companyId && s.period === period)
          .sort(byStartDesc);
      },
      async getReportSnapshot(companyId, id) {
        return (
          data.reportSnapshots.find(
            (s) => s.companyId === companyId && s.id === id,
          ) ?? null
        );
      },
    },

    portalEvents: {
      async listPortalEvents(companyId, opts) {
        const rows = data.portalEvents
          .filter(
            (e) =>
              e.companyId === companyId &&
              (!opts?.since || e.at.getTime() > opts.since.getTime()),
          )
          .sort((a, b) => b.at.getTime() - a.at.getTime());
        return opts?.limit !== undefined ? rows.slice(0, opts.limit) : rows;
      },
    },

    homeTiles: {
      async getHomeTiles(companyId) {
        return homeTilesOf(companyId);
      },
      async getVisibleHomeTiles(companyId, viewer) {
        return homeTilesOf(companyId)
          .filter((t) => t.visible && tileVisibleTo(t.visibility, viewer))
          .map((t) => t.key);
      },
    },
  };
}
