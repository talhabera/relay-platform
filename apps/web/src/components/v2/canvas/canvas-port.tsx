import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Port tone on a canvas node edge (Figma `port` layer, 12px circle centred on the border).
 * idle = hollow (card fill, strong border); active = teal fill (selected card, connected
 * source/connector); pending = amber ring; error = destructive ring.
 */
type CanvasPortTone = "idle" | "active" | "pending" | "error";

const toneClass: Record<CanvasPortTone, string> = {
  idle: "border-border-strong bg-card",
  active: "border-primary bg-primary",
  pending: "border-warning bg-card",
  error: "border-destructive bg-card",
};

type CanvasPortProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Which edge of the node the port sits on. Customer inputs are left, outputs right. */
  side: "left" | "right";
  tone?: CanvasPortTone;
};

/**
 * Edge anchor for the canvas surface (S20 measures `[data-slot=canvas-port]` from the DOM
 * to draw the SVG edge overlay). Decorative to assistive tech.
 */
function CanvasPort({ className, side, tone = "idle", ...props }: CanvasPortProps) {
  return (
    <span
      data-slot="canvas-port"
      data-side={side}
      data-tone={tone}
      aria-hidden
      className={cn(
        "absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-[1.5px]",
        side === "left" ? "-left-[7px]" : "-right-[7px]",
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

export { CanvasPort };
export type { CanvasPortProps, CanvasPortTone };
