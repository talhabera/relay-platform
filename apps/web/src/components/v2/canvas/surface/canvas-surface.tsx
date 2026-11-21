"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { Chip } from "../../primitives/chip";
import {
  type CanvasEdgeLike,
  type CanvasEdgeTone,
  linkedNodeIds,
  type MeasuredEdge,
  measureEdges,
  resolveEdgeTone,
  sameEdges,
} from "./geometry";

type CanvasSurfaceNode = {
  id: string;
  /** Text for this node's linked chip in the list fallback, e.g. "Website widget". */
  label: string;
  /** The node itself (Canvas agent card, Source node, Connector node, ...). Rendered in both layouts. */
  node: React.ReactNode;
};

type CanvasSurfaceColumn = {
  id: string;
  /** Column heading, e.g. "Sources" or "Customer agents". */
  title?: string;
  nodes: CanvasSurfaceNode[];
};

type CanvasSurfaceEdge = CanvasEdgeLike & {
  /** Chip at the edge midpoint. Pending edges default to "Bind agent". */
  label?: string;
};

type CanvasSurfaceProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Left to right. Edges run from a node's right port to a node's left port in a later column. */
  columns: CanvasSurfaceColumn[];
  edges: CanvasSurfaceEdge[];
  /** The selected node highlights its edges (one per view). */
  selectedId?: string;
  /**
   * Column listed first under 1024px, each node followed by chips of its linked nodes
   * (the agents column). The other columns follow in order.
   */
  listColumn: string;
  /** Vertical alignment of the columns against each other. */
  align?: "start" | "center";
  /**
   * Flush inside a tile (Home agent map, 04 `413:52694`): square corners, 24 padding and
   * 48 column gaps instead of the standalone canvas's rounded box, 40 padding and 120 gaps.
   */
  embedded?: boolean;
  /** Extra classes for the node row (padding, column gap), e.g. the overview lanes' tighter 24 gaps. */
  contentClassName?: string;
};

const chipVariant: Record<CanvasEdgeTone, "default" | "selected" | "steering"> = {
  default: "default",
  active: "selected",
  pending: "steering",
};

/**
 * Canvas surface (decision 3, map #29): ordinary HTML nodes in flex columns plus one SVG
 * overlay whose edges are measured from each node's `CanvasPort` and re-measured on resize.
 * No pan, zoom or drag; the page scrolls. Under 1024px (`lg`) it renders a list instead:
 * the `listColumn` nodes with linked chips, then the other columns.
 */
function CanvasSurface({
  className,
  columns,
  edges,
  selectedId,
  listColumn,
  align = "center",
  embedded = false,
  contentClassName,
  ...props
}: CanvasSurfaceProps) {
  return (
    <div data-slot="canvas-surface" role="region" className={cn("w-full", className)} {...props}>
      <CanvasColumns columns={columns} edges={edges} selectedId={selectedId} align={align} embedded={embedded} contentClassName={contentClassName} />
      <CanvasList columns={columns} edges={edges} selectedId={selectedId} listColumn={listColumn} />
    </div>
  );
}

function CanvasColumns({
  columns,
  edges,
  selectedId,
  align,
  embedded,
  contentClassName,
}: Pick<CanvasSurfaceProps, "columns" | "edges" | "selectedId" | "align" | "embedded" | "contentClassName">) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<MeasuredEdge[]>([]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const next = measureEdges(root, edges, selectedId);
      setMeasured((prev) => (sameEdges(prev, next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const node of root.querySelectorAll("[data-canvas-node]")) observer.observe(node);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [columns, edges, selectedId]);

  const labels = new Map(edges.map((e) => [`${e.from}->${e.to}`, e.label]));

  return (
    <div
      data-slot="canvas-surface-canvas"
      className={cn(
        "hidden overflow-x-auto bg-canvas bg-[radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)] [background-size:16px_16px] lg:block",
        !embedded && "rounded-xl",
      )}
    >
      <div
        ref={rootRef}
        className={cn(
          "relative flex w-max min-w-full",
          embedded ? "justify-start gap-x-12 p-6" : "justify-center gap-x-30 p-10",
          align === "center" ? "items-center" : "items-start",
          contentClassName,
        )}
      >
        <svg
          data-slot="canvas-surface-edges"
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          {measured.map((edge) => (
            <g key={edge.key} data-slot="canvas-edge" data-edge={edge.key} data-tone={edge.tone} fill="none">
              {edge.tone === "active" ? (
                <path d={edge.d} stroke="var(--primary-glow)" strokeWidth={6} strokeLinecap="round" />
              ) : null}
              <path
                d={edge.d}
                stroke={edge.tone === "active" ? "var(--primary)" : "var(--border-strong)"}
                strokeWidth={edge.tone === "active" ? 2 : 1.5}
                strokeDasharray={edge.tone === "pending" ? "6 4" : undefined}
              />
            </g>
          ))}
        </svg>
        {measured.map((edge) => {
          const label = labels.get(edge.key) ?? (edge.tone === "pending" ? "Bind agent" : undefined);
          if (!label) return null;
          return (
            <div
              key={edge.key}
              data-slot="canvas-edge-label"
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: edge.mid.x, top: edge.mid.y }}
            >
              <Chip asStatic icon="link" variant={edge.tone === "active" ? "selected" : "default"}>
                {label}
              </Chip>
            </div>
          );
        })}
        {columns.map((column) => (
          <div
            key={column.id}
            data-slot="canvas-surface-column"
            data-column={column.id}
            className="relative z-10 flex flex-col gap-4"
          >
            {column.title ? <h3 className="type-label text-muted-foreground">{column.title}</h3> : null}
            {column.nodes.map((n) => (
              <div key={n.id} data-canvas-node={n.id} data-selected={n.id === selectedId || undefined}>
                {n.node}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CanvasList({
  columns,
  edges,
  selectedId,
  listColumn,
}: Pick<CanvasSurfaceProps, "columns" | "edges" | "selectedId" | "listColumn">) {
  const nodeById = new Map(columns.flatMap((c) => c.nodes.map((n) => [n.id, n] as const)));
  const primary = columns.find((c) => c.id === listColumn);
  const ordered = primary ? [primary, ...columns.filter((c) => c !== primary)] : columns;

  const toneBetween = (a: string, b: string): CanvasEdgeTone => {
    const edge = edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    return edge ? resolveEdgeTone(edge, selectedId) : "default";
  };

  return (
    <div data-slot="canvas-surface-list" className="flex flex-col gap-6 lg:hidden [&_[data-slot=canvas-port]]:hidden">
      {ordered.map((column) => (
        <section key={column.id} data-column={column.id} className="flex flex-col gap-3">
          {column.title ? <h3 className="type-label text-muted-foreground">{column.title}</h3> : null}
          {column.nodes.map((n) => {
            const linked = column === primary ? linkedNodeIds(edges, n.id).filter((id) => nodeById.has(id)) : [];
            return (
              <div key={n.id} data-slot="canvas-list-item" className="flex flex-col gap-2">
                {n.node}
                {linked.length > 0 ? (
                  <div data-slot="canvas-linked-chips" className="flex flex-wrap items-center gap-2">
                    {linked.map((id) => (
                      <Chip key={id} asStatic variant={chipVariant[toneBetween(n.id, id)]}>
                        {nodeById.get(id)?.label}
                      </Chip>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export { CanvasSurface };
export type { CanvasSurfaceColumn, CanvasSurfaceEdge, CanvasSurfaceNode, CanvasSurfaceProps };
