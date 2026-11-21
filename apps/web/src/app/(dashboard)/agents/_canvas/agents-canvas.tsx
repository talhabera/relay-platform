import type * as React from "react";
import Link from "next/link";

import {
  CanvasAgentCard,
  CanvasSurface,
  SourceNode,
  sourceLabel,
  type CanvasSource,
  type CanvasSurfaceColumn,
} from "@/components/v2/canvas";
import { Icon, iconButtonVariants } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { cardNodeId, type AgentsCanvasModel } from "./agents-canvas-model";
import { HandoffCanvasNode, handoffNodeId } from "./handoff/handoff-canvas-node";
import type { HandoffNodeView } from "./handoff/handoff-model";

type AgentsCanvasProps = {
  model: AgentsCanvasModel;
  /** SourceNode Connect / Reconnect (disconnected or error sources). */
  onConnectSource?: (source: CanvasSource) => void;
  /** Menu of a connected source; undefined hides it. */
  sourceMenu?: (source: CanvasSource) => React.ReactNode;
  /** Shown in the agents column when there are no customer agents (Figma 07 `agents-customer/empty`). */
  empty?: React.ReactNode;
  /** The selected agent's Handoff node, drawn under its card; `selected` when its inspector is open. */
  handoff?: { agentId: string; view: HandoffNodeView; selected: boolean };
};

// Sources column drawn as the Figma `sources panel` (411:30123): a card that runs the canvas height.
const SOURCES_PANEL = cn(
  "[&>[data-column=sources]]:self-stretch [&>[data-column=sources]]:gap-3 [&>[data-column=sources]]:rounded-xl",
  "[&>[data-column=sources]]:border [&>[data-column=sources]]:border-border [&>[data-column=sources]]:bg-card [&>[data-column=sources]]:p-4",
);

function agentsCanvasColumns({ model, onConnectSource, sourceMenu, empty, handoff }: AgentsCanvasProps): CanvasSurfaceColumn[] {
  return [
    {
      id: "sources",
      nodes: [
        {
          id: "sources-header",
          label: "Sources",
          node: (
            <div data-slot="agents-sources-header" className="flex flex-col gap-1 pb-3">
              <h2 className="type-h3 text-foreground">Sources</h2>
              <p className="type-small text-muted-foreground">Connect customer channels and platforms.</p>
            </div>
          ),
        },
        ...model.sources.map((s) => ({
          id: s.id,
          label: sourceLabel[s.source],
          node: (
            <SourceNode
              source={s.source}
              state={s.state}
              onConnect={onConnectSource ? () => onConnectSource(s.source) : undefined}
              menu={sourceMenu?.(s.source) ?? null}
            />
          ),
        })),
      ],
    },
    {
      id: "agents",
      nodes:
        model.cards.length === 0 && empty
          ? [{ id: "agents-empty", label: "No customer agents yet", node: empty }]
          : model.cards.flatMap((card) => {
              const nodes = [{ id: card.id, label: card.name, node: <AgentsCanvasCardNode card={card} /> }];
              if (handoff?.agentId === card.agentId) {
                nodes.push({
                  id: handoffNodeId(card.agentId),
                  label: `${card.name} human handoff`,
                  node: (
                    <HandoffCanvasNode
                      agentId={card.agentId}
                      agentName={card.name}
                      view={handoff.view}
                      selected={handoff.selected}
                    />
                  ),
                });
              }
              return nodes;
            }),
    },
  ];
}

function AgentsCanvasCardNode({ card }: { card: AgentsCanvasModel["cards"][number] }) {
  return (
    <div data-slot="agents-canvas-card" className="relative">
      <CanvasAgentCard
        kind="customer"
        name={card.name}
        description={card.description}
        model={card.modelLabel}
        state={card.state}
        metrics={card.metrics}
        glyphs={card.glyphs}
        menu={
          <Link
            href={`/agents/${card.agentId}`}
            aria-label={`Open ${card.name}`}
            className={cn(iconButtonVariants({ size: "sm" }), "z-20")}
          >
            <Icon name="ellipsis" size={16} />
          </Link>
        }
      />
      <Link
        href={`/agents?agent=${card.agentId}`}
        aria-label={`Select ${card.name}`}
        aria-current={card.state === "selected" ? "true" : undefined}
        scroll={false}
        className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>
  );
}

/** Card -> Handoff node, right port to right port (07 Acme canvas). */
export function withHandoffEdge(
  edges: AgentsCanvasModel["edges"],
  handoff: AgentsCanvasProps["handoff"],
): AgentsCanvasModel["edges"] {
  if (!handoff) return edges;
  return [...edges, { from: cardNodeId(handoff.agentId), to: handoffNodeId(handoff.agentId), route: "loop" }];
}

/**
 * Customer Agents canvas (Figma 07 `agents-customer/default`, 411:27660): Sources panel on the
 * left, customer agent cards on the right, edges per active channel. Selecting a card
 * (`?agent=`) highlights its edges. No pan or zoom (canvas decision 3); under 1024 the
 * surface lists the agents with linked source chips.
 */
export function AgentsCanvas(props: AgentsCanvasProps) {
  const { model } = props;
  return (
    <CanvasSurface
      aria-label="Customer agents canvas"
      align="start"
      listColumn="agents"
      columns={agentsCanvasColumns(props)}
      edges={withHandoffEdge(model.edges, props.handoff)}
      selectedId={props.handoff?.selected ? handoffNodeId(props.handoff.agentId) : model.selectedNodeId}
      contentClassName={cn("min-h-[732px] p-4 pr-10", SOURCES_PANEL)}
    />
  );
}
