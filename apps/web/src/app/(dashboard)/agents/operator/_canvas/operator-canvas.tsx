import type * as React from "react";
import Link from "next/link";

import { CanvasPort, CanvasSurface, ConnectorNode, type CanvasSurfaceColumn } from "@/components/v2/canvas";
import { AgentChip, Icon, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import type { OperatorCanvasCard, OperatorCanvasModel } from "./operator-canvas-model";

type OperatorCanvasProps = {
  model: OperatorCanvasModel;
  /** Shown in the agents column when there are no operator agents. */
  empty?: React.ReactNode;
};

// Connectors column drawn as the Figma `Connectors` panel: a card that runs the canvas height.
const CONNECTORS_PANEL = cn(
  "[&>[data-column=connectors]]:self-stretch [&>[data-column=connectors]]:gap-3 [&>[data-column=connectors]]:rounded-xl",
  "[&>[data-column=connectors]]:border [&>[data-column=connectors]]:border-border [&>[data-column=connectors]]:bg-card [&>[data-column=connectors]]:p-4",
);

const BORDER: Record<OperatorCanvasCard["state"], string> = {
  default: "border border-border shadow-elevation-1",
  paused: "border border-border shadow-elevation-1",
  selected: "border-[1.5px] border-primary shadow-glow-primary",
};

/**
 * Operator card of 07 `agents-operator/default`: eyebrow, name, Agent chip with model and live
 * version, a Draft pill when a newer draft exists. Port on the right, towards the connectors.
 */
function OperatorAgentCard({ card }: { card: OperatorCanvasCard }) {
  const paused = card.state === "paused";
  return (
    <div
      data-slot="operator-agent-card"
      data-state={card.state}
      className={cn("relative flex w-[330px] max-w-full flex-col gap-4 rounded-xl bg-card p-5", BORDER[card.state])}
    >
      <div className="flex w-full items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
            paused ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary",
          )}
        >
          <Icon name="bot" size={24} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-label text-muted-foreground">Operator agent</span>
          <span className="type-h3 break-words text-foreground">{card.name}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AgentChip
          kind="operator"
          name={card.modelLabel}
          version={card.liveVersion}
          status={card.liveVersion ? "live" : "none"}
        />
        {card.draftVersion ? (
          <StatusChip tone="draft" className="uppercase">
            {card.draftVersion} Draft
          </StatusChip>
        ) : null}
        {paused ? <StatusChip tone="neutral">Paused</StatusChip> : null}
      </div>
      <CanvasPort side="right" tone={card.state === "selected" ? "active" : "idle"} />
    </div>
  );
}

function operatorCanvasColumns({ model, empty }: OperatorCanvasProps): CanvasSurfaceColumn[] {
  return [
    {
      id: "agents",
      nodes:
        model.cards.length === 0 && empty
          ? [{ id: "agents-empty", label: "No operator agents yet", node: empty }]
          : model.cards.map((card) => ({
              id: card.id,
              label: card.name,
              node: (
                <div data-slot="operator-canvas-card" className="relative">
                  <OperatorAgentCard card={card} />
                  <Link
                    href={`/agents/operator?agent=${card.agentId}`}
                    aria-label={`Select ${card.name}`}
                    aria-current={card.state === "selected" ? "true" : undefined}
                    scroll={false}
                    className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              ),
            })),
    },
    {
      id: "connectors",
      nodes: [
        {
          id: "connectors-header",
          label: "Connectors",
          node: (
            <div data-slot="operator-connectors-header" className="flex flex-col gap-1 pb-3">
              <h2 className="type-h3 text-foreground">Connectors</h2>
              <p className="type-small text-muted-foreground">Accounts operator agents act through.</p>
            </div>
          ),
        },
        ...model.connectors.map((c) => ({
          id: c.id,
          label: c.name,
          node: <ConnectorNode brand={c.brand} name={c.name} status={c.status} className="w-[290px]" />,
        })),
      ],
    },
  ];
}

/**
 * Operator Agents canvas (Figma 07 `agents-operator/default`, 414:55559): operator agent cards
 * on the left, the Connectors panel on the right, one edge per connector an agent acts through.
 * Selecting a card (`?agent=`) highlights its edges. Under 1024 the surface lists the agents
 * with linked connector chips.
 */
export function OperatorCanvas(props: OperatorCanvasProps) {
  const { model } = props;
  return (
    <CanvasSurface
      aria-label="Operator agents canvas"
      align="start"
      listColumn="agents"
      columns={operatorCanvasColumns(props)}
      edges={model.edges}
      selectedId={model.selectedNodeId}
      contentClassName={cn("min-h-[732px] p-4 pl-6 gap-x-20", CONNECTORS_PANEL)}
    />
  );
}
