import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasSurface, type CanvasSurfaceColumn, type CanvasSurfaceEdge } from "./canvas-surface";
import {
  edgeMidpoint,
  edgePath,
  linkedNodeIds,
  loopMidpoint,
  loopPath,
  measureEdges,
  portPoint,
  resolveEdgeTone,
} from "./geometry";

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/** Minimal DOM stand-in: a node wrapper with optional ports, found by `[data-canvas-node="id"]`. */
function fakeNode(box: Rect, ports: { side: "left" | "right"; box: Rect }[] = []) {
  return {
    getBoundingClientRect: () => box,
    querySelector: (sel: string) => {
      const side = sel.match(/data-side="(left|right)"/)?.[1];
      const port = ports.find((p) => p.side === side);
      return port ? { getBoundingClientRect: () => port.box } : null;
    },
  };
}

function fakeRoot(box: Rect, nodes: Record<string, ReturnType<typeof fakeNode>>) {
  return {
    getBoundingClientRect: () => box,
    querySelector: (sel: string) => {
      const id = sel.match(/data-canvas-node="([^"]+)"/)?.[1];
      return id ? (nodes[id] ?? null) : null;
    },
  };
}

describe("edge geometry (C2b1 canvas edges 378:25924)", () => {
  it("draws a cubic with both handles at dx/2", () => {
    expect(edgePath({ x: 117, y: 40 }, { x: 243, y: 120 })).toBe("M 117 40 C 180 40 180 120 243 120");
  });

  it("is a straight line when ports are level", () => {
    expect(edgePath({ x: 0, y: 80 }, { x: 126, y: 80 })).toBe("M 0 80 C 63 80 63 80 126 80");
  });

  it("keeps a minimum handle when the target sits left of the source", () => {
    expect(edgePath({ x: 100, y: 0 }, { x: 80, y: 50 })).toBe("M 100 0 C 140 0 40 50 80 50");
  });

  it("puts the label chip at the curve midpoint", () => {
    expect(edgeMidpoint({ x: 117, y: 40 }, { x: 243, y: 120 })).toEqual({ x: 180, y: 80 });
  });
});

describe("loop edges (04 agent map 414:51771)", () => {
  it("bulges 16.5 right of an 80px stack, handle 22", () => {
    expect(loopPath({ x: 924, y: 87 }, { x: 924, y: 167 })).toBe("M 924 87 C 946 87 946 167 924 167");
    expect(loopMidpoint({ x: 924, y: 87 }, { x: 924, y: 167 })).toEqual({ x: 940.5, y: 127 });
  });

  it("grows the handle with distance, capped at 60", () => {
    expect(loopPath({ x: 0, y: 0 }, { x: 0, y: 160 })).toBe("M 0 0 C 44 0 44 160 0 160");
    expect(loopPath({ x: 0, y: 0 }, { x: 0, y: 1000 })).toBe("M 0 0 C 60 0 60 1000 0 1000");
  });

  it("measures right port to right port", () => {
    const root = rect(0, 0, 1000, 600);
    const nodes = {
      a: fakeNode(rect(600, 50, 300, 70), [{ side: "right", box: rect(894, 79, 12, 12) }]),
      b: fakeNode(rect(600, 130, 300, 70), [{ side: "right", box: rect(894, 159, 12, 12) }]),
    };
    const [edge] = measureEdges(fakeRoot(root, nodes) as unknown as Element, [{ from: "a", to: "b", route: "loop" }], undefined);
    expect(edge).toMatchObject({ from: { x: 900, y: 85 }, to: { x: 900, y: 165 } });
    expect(edge.d).toBe(loopPath({ x: 900, y: 85 }, { x: 900, y: 165 }));
  });
});

describe("edge tone", () => {
  it("pending wins over selection", () => {
    expect(resolveEdgeTone({ from: "a", to: "b", tone: "pending" }, "a")).toBe("pending");
  });
  it("the selected node highlights its edges", () => {
    expect(resolveEdgeTone({ from: "a", to: "b" }, "b")).toBe("active");
    expect(resolveEdgeTone({ from: "a", to: "b" }, "c")).toBe("default");
    expect(resolveEdgeTone({ from: "a", to: "b" }, undefined)).toBe("default");
  });
  it("explicit active stays active (live traffic)", () => {
    expect(resolveEdgeTone({ from: "a", to: "b", tone: "active" }, undefined)).toBe("active");
  });
});

describe("measuring ports from the DOM", () => {
  const root = rect(100, 50, 1000, 600);

  it("reads the CanvasPort centre relative to the surface", () => {
    const node = fakeNode(rect(120, 60, 300, 80), [{ side: "right", box: rect(413, 94, 12, 12) }]);
    expect(portPoint(node as unknown as Element, "right", root)).toEqual({ x: 319, y: 50 });
  });

  it("falls back to the node edge midpoint when the node has no port", () => {
    const node = fakeNode(rect(500, 100, 360, 200));
    expect(portPoint(node as unknown as Element, "left", root)).toEqual({ x: 400, y: 150 });
    expect(portPoint(node as unknown as Element, "right", root)).toEqual({ x: 760, y: 150 });
  });

  it("measures from-right to to-left, skips missing nodes, draws active over default", () => {
    const nodes = {
      web: fakeNode(rect(100, 50, 300, 80), [{ side: "right", box: rect(394, 84, 12, 12) }]),
      wa: fakeNode(rect(100, 150, 300, 80), [{ side: "right", box: rect(394, 184, 12, 12) }]),
      bot: fakeNode(rect(600, 50, 360, 300), [{ side: "left", box: rect(594, 194, 12, 12) }]),
    };
    const edges: CanvasSurfaceEdge[] = [
      { from: "web", to: "bot", tone: "active" },
      { from: "wa", to: "bot" },
      { from: "ghost", to: "bot" },
    ];
    const out = measureEdges(fakeRoot(root, nodes) as unknown as Element, edges, undefined);
    expect(out.map((e) => [e.key, e.tone])).toEqual([
      ["wa->bot", "default"],
      ["web->bot", "active"],
    ]);
    expect(out[1]).toMatchObject({ from: { x: 300, y: 40 }, to: { x: 500, y: 150 }, mid: { x: 400, y: 95 } });
  });
});

describe("linked nodes", () => {
  it("lists neighbours in either direction, once, in edge order", () => {
    const edges = [
      { from: "web", to: "bot" },
      { from: "bot", to: "hand" },
      { from: "web", to: "bot" },
      { from: "x", to: "y" },
    ];
    expect(linkedNodeIds(edges, "bot")).toEqual(["web", "hand"]);
  });
});

const card = (id: string) => h("div", { "data-testid": id }, h("span", { "data-slot": "canvas-port", "data-side": "left" }));
const columns: CanvasSurfaceColumn[] = [
  {
    id: "sources",
    title: "Sources",
    nodes: [
      { id: "web", label: "Website widget", node: card("web") },
      { id: "ig", label: "Instagram", node: card("ig") },
    ],
  },
  {
    id: "agents",
    title: "Customer agents",
    nodes: [
      { id: "bot", label: "Acme Website Assistant", node: card("bot") },
      { id: "none", label: "No agent", node: card("none") },
    ],
  },
];
const edges: CanvasSurfaceEdge[] = [
  { from: "web", to: "bot" },
  { from: "ig", to: "none", tone: "pending" },
];

describe("CanvasSurface (decision 3, map #29)", () => {
  const html = renderToStaticMarkup(
    h(CanvasSurface, { columns, edges, listColumn: "agents", selectedId: "bot", "aria-label": "Agents canvas" }),
  );
  const canvas = html.slice(html.indexOf('data-slot="canvas-surface-canvas"'), html.indexOf('data-slot="canvas-surface-list"'));
  const list = html.slice(html.indexOf('data-slot="canvas-surface-list"'));

  it("renders columns of HTML nodes plus one SVG overlay, desktop only (lg)", () => {
    expect(canvas).toMatch(/^data-slot="canvas-surface-canvas"[^>]*class="[^"]*hidden[^"]*lg:block/);
    expect(canvas.split("<svg").length - 1).toBe(1);
    expect(canvas).toContain('data-slot="canvas-surface-edges"');
    expect(canvas.split('data-slot="canvas-surface-column"').length - 1).toBe(2);
    for (const id of ["web", "ig", "bot", "none"]) expect(canvas).toContain(`data-canvas-node="${id}"`);
    expect(canvas).toContain('data-selected="true"');
  });

  it("has no pan, zoom or drag affordances", () => {
    expect(html).not.toMatch(/draggable|zoom|transform: ?scale/i);
  });

  it("under 1024 shows a list: agent nodes with linked chips, then the other column", () => {
    expect(list).toMatch(/^data-slot="canvas-surface-list"[^>]*class="[^"]*lg:hidden/);
    const order = ["Customer agents", 'data-testid="bot"', "Website widget", 'data-testid="none"', "Instagram", "Sources", 'data-testid="web"', 'data-testid="ig"'];
    const at = order.map((s) => list.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(list.split('data-slot="canvas-linked-chips"').length - 1).toBe(2);
  });

  it("marks the pending link chip as steering and hides ports in the list", () => {
    expect(list).toMatch(/data-variant="steering"[^>]*>.*?Instagram/);
    expect(list).toMatch(/class="[^"]*\[&amp;_\[data-slot=canvas-port\]\]:hidden/);
  });

  it("labels the region", () => {
    expect(html).toContain('aria-label="Agents canvas"');
  });

  it("embedded drops the rounded box and uses the tile spacing", () => {
    const embedded = renderToStaticMarkup(h(CanvasSurface, { columns, edges, listColumn: "agents", embedded: true }));
    const box = embedded.match(/data-slot="canvas-surface-canvas" class="([^"]*)"/)?.[1] ?? "";
    expect(box).not.toContain("rounded-xl");
    expect(embedded).toMatch(/gap-x-12 p-6/);
    expect(html).toMatch(/gap-x-30 p-10/);
  });
});
