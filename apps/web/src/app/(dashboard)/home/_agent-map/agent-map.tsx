import { CanvasAgentNode, CanvasSurface, SourceNode, sourceLabel, type CanvasSurfaceColumn } from "@/components/v2/canvas";
import { Chip, StatusChip, type IconName } from "@/components/v2/primitives";

import type { AgentMapModel } from "./agent-map-model";

const INTEGRATION_ICON: Record<string, IconName> = {
  "Knowledge base": "book-open",
  "Human handoff": "hand-helping",
};

function agentMapColumns(model: AgentMapModel): CanvasSurfaceColumn[] {
  const columns: CanvasSurfaceColumn[] = [];
  if (model.sources.length > 0) {
    columns.push({
      id: "sources",
      title: "Sources",
      nodes: model.sources.map((s) => ({
        id: s.id,
        label: sourceLabel[s.source],
        node: <SourceNode source={s.source} menu={null} className="w-46" />,
      })),
    });
  }
  if (model.customers.length > 0 || model.integrations.length > 0) {
    const nodes = model.customers.map((c) => ({
      id: c.id,
      label: c.name,
      node: (
        <CanvasAgentNode
          kind="customer"
          name={c.name}
          eyebrow="Customer agent"
          status={c.status}
          state={c.paused ? "paused" : "default"}
          ports={["left", "right"]}
        />
      ),
    }));
    if (model.integrations.length > 0) {
      nodes.push({
        id: "integrations",
        label: "Integrations",
        node: (
          <div data-slot="agent-map-integrations" className="flex flex-col gap-3 pt-6">
            <h3 className="type-label text-muted-foreground">Integrations</h3>
            <div className="flex flex-wrap gap-2">
              {model.integrations.map((name) => (
                <Chip key={name} asStatic icon={INTEGRATION_ICON[name]}>
                  {name}
                </Chip>
              ))}
            </div>
          </div>
        ),
      });
    }
    columns.push({ id: "customers", title: "Customer agents", nodes });
  }
  if (model.operators.length > 0) {
    columns.push({
      id: "operators",
      title: "Operator agents",
      nodes: model.operators.map((o) => ({
        id: o.id,
        label: o.name,
        node: (
          <CanvasAgentNode
            kind="operator"
            name={o.name}
            eyebrow={o.eyebrow}
            icon={o.icon}
            status={o.status}
            state={o.paused ? "paused" : "default"}
            ports={["left", "right"]}
          />
        ),
      })),
    });
  }
  return columns;
}

/**
 * Home agent map tile (Figma 04 `home/default`, `413:52668`). Read-only: no zoom, pan or
 * selection (canvas decision 3). Under 1024 the surface renders its list fallback.
 */
export function AgentMap({ model }: { model: AgentMapModel }) {
  const columns = agentMapColumns(model);
  return (
    <section
      data-slot="agent-map"
      aria-labelledby="home-agent-map-title"
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-1"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        {model.live ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
        <h2 id="home-agent-map-title" className="type-h3 text-foreground">
          Agent map
        </h2>
        {model.live ? (
          <StatusChip tone="live" className="uppercase">
            Live
          </StatusChip>
        ) : null}
        <span data-slot="agent-map-meta" className="ml-auto type-small text-muted-foreground">
          {model.meta}
        </span>
      </header>
      <CanvasSurface
        embedded
        align="start"
        aria-label="Agent map"
        listColumn="customers"
        columns={columns}
        edges={model.edges}
        className="max-lg:p-4"
      />
      {model.legend ? (
        <p data-slot="agent-map-legend" className="px-4 pb-4 type-caption text-muted-foreground lg:bg-canvas lg:px-6">
          {model.legend}
        </p>
      ) : null}
    </section>
  );
}
