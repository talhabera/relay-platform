import type { CanvasSurfaceEdge, ConnectorNodeStatus } from "@/components/v2/canvas";
import type { BrandName } from "@/components/v2/primitives";

// Pure view model for the operator Agents canvas (Figma 07 `agents-operator/default`, 414:55559):
// operator agent cards on the left, the company's connectors on the right, one edge per
// connector an agent acts through, and the selected agent's inspector data.

export type OperatorModel = "haiku" | "sonnet" | "opus";

export type OperatorToolToggles = {
  webSearch: boolean;
  excel: boolean;
  companyMemory: boolean;
  proposeAction: boolean;
};

export type OperatorCanvasVersion = {
  id: string;
  agentId: string;
  name: string;
  status: "live" | "draft";
  model: OperatorModel;
  parentVersionId: string | null;
  /** Fork dialog change note (`agent_versions.change_note`). */
  changeNote?: string | null;
  toolToggles: OperatorToolToggles;
  createdAt: Date;
};

export type OperatorCanvasAgent = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

/** Mirrors `integrations.type`; only the operator connector types are drawn. */
export type OperatorConnectorType =
  | "hunter"
  | "snov"
  | "google_places"
  | "slack"
  | "google_workspace"
  | "meta"
  | "linkedin"
  | "google_business_profile"
  | "trustpilot";

export type OperatorCanvasIntegration = {
  /** Any `integrations.type`; customer-only types are ignored. */
  type: string;
  /** null = company-wide. */
  agentId: string | null;
  status: ConnectorNodeStatus;
};

export type OperatorCanvasStage = { agentId: string; workflowName: string; stageName: string };

export type OperatorCanvasInput = {
  /** Operator agents only, in display order. */
  agents: readonly OperatorCanvasAgent[];
  /** Every version of those agents (any order). */
  versions: readonly OperatorCanvasVersion[];
  integrations: readonly OperatorCanvasIntegration[];
  /** Workflow stages run by operator agents ("Used in"). */
  stages?: readonly OperatorCanvasStage[];
};

export type OperatorCanvasConnector = {
  id: string;
  type: OperatorConnectorType;
  brand: BrandName;
  name: string;
  status: ConnectorNodeStatus;
};

export type OperatorCanvasCard = {
  id: string;
  agentId: string;
  name: string;
  modelLabel: string;
  /** Live version name, e.g. "v1"; undefined before the first promote. */
  liveVersion?: string;
  /** Newest draft newer than live, e.g. "v2". */
  draftVersion?: string;
  state: "default" | "selected" | "paused";
};

export type OperatorCanvasVersionRow = {
  id: string;
  name: string;
  status: "live" | "draft";
  /** "Forked from v1" when the parent is known. */
  forkedFrom?: string;
  /** Change note from the fork dialog, the Version ticket title. */
  note?: string;
  createdAt: Date;
  focused: boolean;
};

export type OperatorCanvasSelection = {
  agentId: string;
  name: string;
  description?: string;
  /** Version shown in the Agent chip and the Tools list (`?version=`, else the newest). */
  focusVersion?: { id: string; name: string; status: "live" | "draft" };
  versions: OperatorCanvasVersionRow[];
  modelLabel: string;
  connectors: { name: string; brand: BrandName }[];
  usedIn: string[];
  tools: string[];
};

export type OperatorCanvasModel = {
  cards: OperatorCanvasCard[];
  connectors: OperatorCanvasConnector[];
  edges: CanvasSurfaceEdge[];
  selectedNodeId?: string;
  selected?: OperatorCanvasSelection;
};

/** `?agent=none` closes the inspector. */
export const NO_SELECTION = "none";

export const operatorCardNodeId = (agentId: string) => `operator:${agentId}`;
export const connectorNodeId = (type: OperatorConnectorType) => `connector:${type}`;

/** Figma order of the Connectors panel. */
export const OPERATOR_CONNECTORS: readonly { type: OperatorConnectorType; brand: BrandName; name: string }[] = [
  { type: "hunter", brand: "hunter", name: "Hunter" },
  { type: "snov", brand: "snov", name: "Snov" },
  { type: "google_places", brand: "google-places", name: "Google Places" },
  { type: "slack", brand: "slack", name: "Slack" },
  { type: "google_workspace", brand: "google-workspace", name: "Google Workspace" },
  { type: "meta", brand: "meta", name: "Meta" },
  { type: "linkedin", brand: "linkedin", name: "LinkedIn" },
  { type: "google_business_profile", brand: "google-business", name: "Google Business Profile" },
  { type: "trustpilot", brand: "trustpilot", name: "Trustpilot" },
];

/**
 * Research connectors every operator agent's runtime registers (worker `applyResearchTools`);
 * credentials are company-scoped (operator integrations spec). Other connectors link only to
 * an agent an integration row names.
 */
export const RESEARCH_CONNECTORS: ReadonlySet<OperatorConnectorType> = new Set(["hunter", "snov", "google_places"]);

const MODEL_LABEL: Record<OperatorModel, string> = {
  haiku: "Claude Haiku",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
};

const TOOL_LABEL: Record<keyof OperatorToolToggles, string> = {
  webSearch: "Web search",
  excel: "Excel",
  companyMemory: "Company memory",
  proposeAction: "Propose action",
};

// Worst first: an errored row surfaces even when another row of the type is connected.
const STATUS_RANK: Record<ConnectorNodeStatus, number> = { error: 3, connected: 2, pending: 1, disconnected: 0 };

const isOperatorConnector = (type: string): type is OperatorConnectorType =>
  OPERATOR_CONNECTORS.some((c) => c.type === type);

const newestFirst = (a: OperatorCanvasVersion, b: OperatorCanvasVersion) =>
  b.createdAt.getTime() - a.createdAt.getTime();

export function buildOperatorCanvas(
  input: OperatorCanvasInput,
  selectedAgentId: string | undefined,
  focusVersionId?: string,
): OperatorCanvasModel {
  const agentIds = new Set(input.agents.map((a) => a.id));
  const selected =
    selectedAgentId === NO_SELECTION
      ? undefined
      : selectedAgentId && agentIds.has(selectedAgentId)
        ? selectedAgentId
        : input.agents[0]?.id;

  const versionsByAgent = new Map<string, OperatorCanvasVersion[]>();
  for (const v of input.versions) {
    if (!agentIds.has(v.agentId)) continue;
    const list = versionsByAgent.get(v.agentId) ?? [];
    list.push(v);
    versionsByAgent.set(v.agentId, list);
  }
  for (const list of versionsByAgent.values()) list.sort(newestFirst);

  const statusByType = new Map<OperatorConnectorType, ConnectorNodeStatus>();
  const ownTypes = new Map<string, Set<OperatorConnectorType>>();
  for (const row of input.integrations) {
    if (!isOperatorConnector(row.type)) continue;
    const prev = statusByType.get(row.type);
    if (!prev || STATUS_RANK[row.status] > STATUS_RANK[prev]) statusByType.set(row.type, row.status);
    if (row.agentId && agentIds.has(row.agentId)) {
      const own = ownTypes.get(row.agentId) ?? new Set<OperatorConnectorType>();
      own.add(row.type);
      ownTypes.set(row.agentId, own);
    }
  }

  const connectors = OPERATOR_CONNECTORS.map(
    (c): OperatorCanvasConnector => ({
      id: connectorNodeId(c.type),
      type: c.type,
      brand: c.brand,
      name: c.name,
      status: statusByType.get(c.type) ?? "disconnected",
    }),
  );

  /** Connectors an agent acts through: connected research connectors plus its own rows. */
  const linkedTypes = (agentId: string): OperatorConnectorType[] =>
    OPERATOR_CONNECTORS.filter(
      (c) =>
        (RESEARCH_CONNECTORS.has(c.type) && statusByType.get(c.type) === "connected") ||
        ownTypes.get(agentId)?.has(c.type),
    ).map((c) => c.type);

  const edges: CanvasSurfaceEdge[] = input.agents.flatMap((a) =>
    linkedTypes(a.id).map((type) => ({ from: operatorCardNodeId(a.id), to: connectorNodeId(type) })),
  );

  const cards = input.agents.map((a): OperatorCanvasCard => {
    const versions = versionsByAgent.get(a.id) ?? [];
    const live = versions.find((v) => v.status === "live");
    const draft = versions.find((v) => v.status === "draft" && (!live || v.createdAt > live.createdAt));
    return {
      id: operatorCardNodeId(a.id),
      agentId: a.id,
      name: a.name,
      modelLabel: MODEL_LABEL[(live ?? versions[0])?.model ?? "haiku"],
      liveVersion: live?.name,
      draftVersion: draft?.name,
      state: a.id === selected ? "selected" : a.isActive ? "default" : "paused",
    };
  });

  const agent = input.agents.find((a) => a.id === selected);
  let selection: OperatorCanvasSelection | undefined;
  if (agent) {
    const versions = versionsByAgent.get(agent.id) ?? [];
    const names = new Map(versions.map((v) => [v.id, v.name]));
    const focus = versions.find((v) => v.id === focusVersionId) ?? versions[0];
    const types = new Set(linkedTypes(agent.id));
    selection = {
      agentId: agent.id,
      name: agent.name,
      description: agent.description ?? undefined,
      focusVersion: focus ? { id: focus.id, name: focus.name, status: focus.status } : undefined,
      versions: versions.map((v) => {
        const parent = v.parentVersionId ? names.get(v.parentVersionId) : undefined;
        return {
          id: v.id,
          name: v.name,
          status: v.status,
          forkedFrom: parent ? `Forked from ${parent}` : undefined,
          note: v.changeNote?.trim() || undefined,
          createdAt: v.createdAt,
          focused: v.id === focus?.id,
        };
      }),
      modelLabel: MODEL_LABEL[focus?.model ?? "haiku"],
      connectors: OPERATOR_CONNECTORS.filter((c) => types.has(c.type)).map((c) => ({ name: c.name, brand: c.brand })),
      usedIn: (input.stages ?? [])
        .filter((s) => s.agentId === agent.id)
        .map((s) => `${s.workflowName} · ${s.stageName}`),
      tools: focus
        ? (Object.keys(TOOL_LABEL) as (keyof OperatorToolToggles)[])
            .filter((key) => focus.toolToggles[key])
            .map((key) => TOOL_LABEL[key])
        : [],
    };
  }

  return {
    cards,
    connectors,
    edges,
    selectedNodeId: selected ? operatorCardNodeId(selected) : undefined,
    selected: selection,
  };
}
