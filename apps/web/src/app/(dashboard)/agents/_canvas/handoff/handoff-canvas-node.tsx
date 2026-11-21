import Link from "next/link";

import { HandoffNode } from "@/components/v2/canvas";

import type { HandoffNodeView } from "./handoff-model";

export const handoffNodeId = (agentId: string) => `handoff:${agentId}`;

export const handoffHref = (agentId: string) => `/agents?agent=${agentId}&panel=handoff`;

/**
 * The selected customer agent's Handoff node on the canvas (Figma 07 Handoff node, labels per
 * mode in `07/_local/handoff node labels`). Selecting it opens the Handoff settings inspector.
 */
export function HandoffCanvasNode({
  agentId,
  agentName,
  view,
  selected,
}: {
  agentId: string;
  agentName: string;
  view: HandoffNodeView;
  selected: boolean;
}) {
  return (
    <div data-slot="agents-handoff-node" className="relative">
      <HandoffNode
        state={selected ? "selected" : "default"}
        title={view.title}
        expiry={view.expiry}
        recipient={view.who.kind === "group" ? view.who.label : (view.who.name ?? "")}
        notice={view.who.kind === "warning" ? view.who.label : undefined}
        avatar={view.who.kind === "person" || Boolean(view.who.kind === "warning" && view.who.name)}
        fallback={view.fallback}
        className="w-full"
      />
      <Link
        href={handoffHref(agentId)}
        aria-label={`Handoff settings for ${agentName}`}
        aria-current={selected ? "true" : undefined}
        scroll={false}
        className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>
  );
}
