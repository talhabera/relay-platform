/**
 * Pure edge geometry for the canvas surface (decision 3, map #29). Edges follow the Figma
 * board `C2b1/canvas edges (dark)` (02 `378:25924`): a cubic from the source's right port to
 * the target's left port with both handles at dx/2, so level ports give a straight line.
 */

type Point = { x: number; y: number };

/** default = border-strong 1.5; active = primary 2 over a primary-glow 6 halo; pending = dashed 6 4 + label chip. */
type CanvasEdgeTone = "default" | "active" | "pending";

type CanvasEdgeLike = {
  /** Node id on the left (its right port). */
  from: string;
  /** Node id on the right (its left port). */
  to: string;
  /** Omit to derive from the selection; `active` also marks live traffic; `pending` wins over both. */
  tone?: CanvasEdgeTone;
  /**
   * `forward` (default): source's right port to target's left port, for nodes in later columns.
   * `loop`: right port to right port, for stacked nodes in one column (Home agent map's
   * operator → operator sequence edges, 04 `414:51771`).
   */
  route?: "forward" | "loop";
};

type MeasuredEdge = { key: string; tone: CanvasEdgeTone; from: Point; to: Point; mid: Point; d: string };

/** Smallest handle length, so backward or near-vertical edges still leave and enter horizontally. */
const MIN_HANDLE = 40;

const round = (n: number) => Math.round(n * 100) / 100;

function edgePath(a: Point, b: Point): string {
  const handle = Math.max(Math.abs(b.x - a.x) / 2, MIN_HANDLE);
  const c1 = round(a.x + handle);
  const c2 = round(b.x - handle);
  return `M ${round(a.x)} ${round(a.y)} C ${c1} ${round(a.y)} ${c2} ${round(b.y)} ${round(b.x)} ${round(b.y)}`;
}

/** Loop handle: 22 at the design's 80px stack (curve bulges 0.75 x 22 = 16.5 right), growing with distance, capped. */
const LOOP_HANDLE_MIN = 22;
const LOOP_HANDLE_MAX = 60;

function loopHandle(a: Point, b: Point): number {
  return Math.min(Math.max(Math.abs(b.y - a.y) * 0.275, LOOP_HANDLE_MIN), LOOP_HANDLE_MAX);
}

/** Right port to right port: both handles point right, so the edge bulges out beside the column. */
function loopPath(a: Point, b: Point): string {
  const h = loopHandle(a, b);
  return `M ${round(a.x)} ${round(a.y)} C ${round(a.x + h)} ${round(a.y)} ${round(b.x + h)} ${round(b.y)} ${round(b.x)} ${round(b.y)}`;
}

/** t = 0.5 of the loop cubic: x is pushed out by 0.75 of the handle. */
function loopMidpoint(a: Point, b: Point): Point {
  const h = loopHandle(a, b);
  return { x: round((a.x + b.x) / 2 + 0.75 * h), y: round((a.y + b.y) / 2) };
}

/** t = 0.5 on the symmetric cubic above is the midpoint of its endpoints. */
function edgeMidpoint(a: Point, b: Point): Point {
  return { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) };
}

function resolveEdgeTone(edge: CanvasEdgeLike, selectedId: string | undefined): CanvasEdgeTone {
  if (edge.tone === "pending") return "pending";
  if (edge.tone === "active") return "active";
  if (selectedId !== undefined && (edge.from === selectedId || edge.to === selectedId)) return "active";
  return "default";
}

type RectLike = { left: number; top: number; width: number; height: number };

/**
 * Centre of the node's `CanvasPort` on `side`, relative to `origin`. Nodes without a port
 * (plain HTML stubs) fall back to the middle of that edge of the node box.
 */
function portPoint(node: Element, side: "left" | "right", origin: RectLike): Point {
  const port = node.querySelector(`[data-slot="canvas-port"][data-side="${side}"]`);
  const box = (port ?? node).getBoundingClientRect();
  const x = port ? box.left + box.width / 2 : side === "left" ? box.left : box.left + box.width;
  return { x: round(x - origin.left), y: round(box.top + box.height / 2 - origin.top) };
}

/** Measure every edge whose nodes are mounted under `root` (`[data-canvas-node]`). Active edges sort last so they draw on top. */
function measureEdges(root: Element, edges: readonly CanvasEdgeLike[], selectedId: string | undefined): MeasuredEdge[] {
  const origin = root.getBoundingClientRect();
  const out: MeasuredEdge[] = [];
  for (const edge of edges) {
    const fromNode = root.querySelector(`[data-canvas-node="${escapeAttr(edge.from)}"]`);
    const toNode = root.querySelector(`[data-canvas-node="${escapeAttr(edge.to)}"]`);
    if (!fromNode || !toNode) continue;
    const loop = edge.route === "loop";
    const from = portPoint(fromNode, "right", origin);
    const to = portPoint(toNode, loop ? "right" : "left", origin);
    out.push({
      key: `${edge.from}->${edge.to}`,
      tone: resolveEdgeTone(edge, selectedId),
      from,
      to,
      mid: loop ? loopMidpoint(from, to) : edgeMidpoint(from, to),
      d: loop ? loopPath(from, to) : edgePath(from, to),
    });
  }
  const rank: Record<CanvasEdgeTone, number> = { default: 0, pending: 1, active: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** Attribute-selector-safe id (CSS.escape is not available in the node test env). */
function escapeAttr(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/** Ids linked to `id` by any edge, in edge order, without duplicates. */
function linkedNodeIds(edges: readonly CanvasEdgeLike[], id: string): string[] {
  const seen = new Set<string>();
  for (const edge of edges) {
    const other = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
    if (other !== undefined) seen.add(other);
  }
  return [...seen];
}

function sameEdges(a: readonly MeasuredEdge[], b: readonly MeasuredEdge[]): boolean {
  return a.length === b.length && a.every((e, i) => e.key === b[i].key && e.tone === b[i].tone && e.d === b[i].d);
}

export { edgeMidpoint, edgePath, linkedNodeIds, loopMidpoint, loopPath, measureEdges, portPoint, resolveEdgeTone, sameEdges };
export type { CanvasEdgeLike, CanvasEdgeTone, MeasuredEdge, Point };
