import type {
  CanvasAgentCardState,
  CanvasAgentMetric,
  CanvasSource,
  CanvasSurfaceEdge,
  SourceNodeState,
} from "@/components/v2/canvas";
import type { BrandName } from "@/components/v2/primitives";

// Pure view model for the customer Agents canvas (Figma 07 `agents-customer/default`,
// 411:27660): every source on the left (connected when a customer agent has an active
// channel of that type), customer agent cards on the right, one edge per active channel.

export type AgentsCanvasAgent = {
  id: string;
  name: string;
  description: string | null;
  model: "haiku" | "sonnet" | "opus";
  isActive: boolean;
  /** Inspector Instructions tab. */
  instructions?: string | null;
  /** Last agent save, shown under the instructions. */
  updatedAt?: Date | null;
};

/** One `integrations` row of the company; agentId null means company-wide. */
export type AgentsCanvasIntegration = {
  id: string;
  agentId: string | null;
  name: string;
  /** `integrations.type`, e.g. shopify, slack, mcp_custom. */
  type: string;
  connected: boolean;
};

export type AgentsCanvasChannel = {
  id: string;
  agentId: string;
  type: "widget" | "whatsapp" | "instagram" | "messenger" | "telegram";
  active: boolean;
};

export type AgentsCanvasInput = {
  /** Customer agents only, in display order. */
  agents: readonly AgentsCanvasAgent[];
  channels: readonly AgentsCanvasChannel[];
  /** agentId -> chats started in the last 7 days. */
  chatsThisWeek: ReadonlyMap<string, number>;
  /** agentId -> leads with status `new`. */
  leadsToQualify: ReadonlyMap<string, number>;
  /** Company integrations for the inspector Integrations tab. */
  integrations?: readonly AgentsCanvasIntegration[];
};

export type AgentsCanvasSource = { id: string; source: CanvasSource; state: SourceNodeState };

export type AgentsCanvasCard = {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  modelLabel: string;
  state: CanvasAgentCardState;
  metrics: [CanvasAgentMetric, CanvasAgentMetric];
  glyphs: BrandName[];
};

/** One channel of the selected agent, drawn as a Binding row in the Sources inspector. */
export type AgentsCanvasBinding = {
  channelId: string;
  source: CanvasSource;
  status: "live" | "paused";
};

/**
 * One row of the Add source dialog (Figma 07 `agents-customer/add-binding`, 411:31835) for the
 * selected agent. Sources the agent already has are left out. `boundTo` names the other customer
 * agents that answer this source today; binding adds a new account, it never moves theirs.
 */
export type AgentsCanvasSourceOption = {
  source: CanvasSource;
  boundTo: string[];
};

export type AgentsCanvasSelection = {
  agentId: string;
  name: string;
  description?: string;
  modelLabel: string;
  isActive: boolean;
  bindings: AgentsCanvasBinding[];
  addOptions: AgentsCanvasSourceOption[];
  instructions: string;
  instructionsSavedAt?: Date;
  /** The agent's own integrations, then company-wide ones. */
  integrations: AgentsCanvasIntegration[];
};

export type AgentsCanvasModel = {
  sources: AgentsCanvasSource[];
  cards: AgentsCanvasCard[];
  edges: CanvasSurfaceEdge[];
  selectedNodeId?: string;
  /** The selected agent with its bindings; undefined without agents or after closing (`?agent=none`). */
  selected?: AgentsCanvasSelection;
};

/** `?agent=none` closes the inspector: no card is selected. */
export const NO_SELECTION = "none";

export const sourceNodeId = (source: CanvasSource) => `source:${source}`;
export const cardNodeId = (agentId: string) => `card:${agentId}`;

const SOURCE_ORDER: readonly CanvasSource[] = ["website", "whatsapp", "instagram", "messenger", "telegram"];

const CHANNEL_SOURCE: Record<AgentsCanvasChannel["type"], CanvasSource> = {
  widget: "website",
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  telegram: "telegram",
};

const MODEL_LABEL: Record<AgentsCanvasAgent["model"], string> = {
  haiku: "Claude Haiku",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
};

export function buildAgentsCanvas(input: AgentsCanvasInput, selectedAgentId: string | undefined): AgentsCanvasModel {
  const agentIds = new Set(input.agents.map((a) => a.id));
  const selected =
    selectedAgentId === NO_SELECTION
      ? undefined
      : selectedAgentId && agentIds.has(selectedAgentId)
        ? selectedAgentId
        : input.agents[0]?.id;

  const connected = new Set<CanvasSource>();
  const sourcesByAgent = new Map<string, Set<CanvasSource>>();
  const edges: CanvasSurfaceEdge[] = [];
  const seen = new Set<string>();
  for (const ch of input.channels) {
    if (!ch.active || !agentIds.has(ch.agentId)) continue;
    const source = CHANNEL_SOURCE[ch.type];
    connected.add(source);
    const own = sourcesByAgent.get(ch.agentId) ?? new Set<CanvasSource>();
    own.add(source);
    sourcesByAgent.set(ch.agentId, own);
    const edge = { from: sourceNodeId(source), to: cardNodeId(ch.agentId) };
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }

  const sources = SOURCE_ORDER.map(
    (source): AgentsCanvasSource => ({
      id: sourceNodeId(source),
      source,
      state: connected.has(source) ? "connected" : "disconnected",
    }),
  );

  const cards = input.agents.map((a): AgentsCanvasCard => {
    const own = sourcesByAgent.get(a.id);
    return {
      id: cardNodeId(a.id),
      agentId: a.id,
      name: a.name,
      description: a.description ?? undefined,
      modelLabel: MODEL_LABEL[a.model],
      state: a.id === selected ? "selected" : a.isActive ? "default" : "paused",
      metrics: [
        { value: input.chatsThisWeek.get(a.id) ?? 0, label: "Chats this week" },
        { value: input.leadsToQualify.get(a.id) ?? 0, label: "Leads to qualify" },
      ],
      glyphs: own ? SOURCE_ORDER.filter((s) => own.has(s)) : [],
    };
  });

  const selectedAgent = input.agents.find((a) => a.id === selected);
  return {
    sources,
    cards,
    edges,
    selectedNodeId: selected ? cardNodeId(selected) : undefined,
    selected: selectedAgent ? buildSelection(input, selectedAgent) : undefined,
  };
}

function buildSelection(input: AgentsCanvasInput, agent: AgentsCanvasAgent): AgentsCanvasSelection {
  const names = new Map(input.agents.map((a) => [a.id, a.name]));
  const own = input.channels.filter((ch) => ch.agentId === agent.id);
  const ownSources = new Set(own.map((ch) => CHANNEL_SOURCE[ch.type]));

  const bindings = SOURCE_ORDER.flatMap((source) =>
    own
      .filter((ch) => CHANNEL_SOURCE[ch.type] === source)
      .map((ch): AgentsCanvasBinding => ({
        channelId: ch.id,
        source,
        status: ch.active ? "live" : "paused",
      })),
  );

  const addOptions = SOURCE_ORDER.filter((source) => !ownSources.has(source)).map(
    (source): AgentsCanvasSourceOption => {
      const boundTo: string[] = [];
      for (const ch of input.channels) {
        if (CHANNEL_SOURCE[ch.type] !== source || ch.agentId === agent.id) continue;
        const name = names.get(ch.agentId);
        if (name && !boundTo.includes(name)) boundTo.push(name);
      }
      return { source, boundTo };
    },
  );

  return {
    agentId: agent.id,
    name: agent.name,
    description: agent.description ?? undefined,
    modelLabel: MODEL_LABEL[agent.model],
    isActive: agent.isActive,
    bindings,
    addOptions,
    instructions: agent.instructions ?? "",
    instructionsSavedAt: agent.updatedAt ?? undefined,
    integrations: [
      ...(input.integrations ?? []).filter((i) => i.agentId === agent.id),
      ...(input.integrations ?? []).filter((i) => i.agentId === null),
    ],
  };
}
