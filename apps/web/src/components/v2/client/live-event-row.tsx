import * as React from "react";

import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Icon, type IconName } from "../primitives/icon";

type LiveEventKind = "lead" | "booking" | "handoff" | "review" | "conversation";

/** Kind tile per Figma `kind`: icon + tile tint; `source` is the default Brand glyph. */
const LIVE_EVENT_KINDS: Record<LiveEventKind, { icon: IconName; tile: string; source: BrandName }> = {
  lead: { icon: "user-check", tile: "bg-primary-soft text-primary", source: "website" },
  booking: { icon: "calendar-check", tile: "bg-secondary text-foreground", source: "whatsapp" },
  handoff: { icon: "hand-helping", tile: "bg-status-needs-you text-status-needs-you-foreground", source: "website" },
  review: { icon: "star", tile: "bg-secondary text-foreground", source: "google" },
  conversation: { icon: "message-square", tile: "bg-secondary text-foreground", source: "instagram" },
};

type LiveEventRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  kind: LiveEventKind;
  /** TEXT `time` (company timezone, e.g. "11:05"). */
  time: string;
  /** TEXT `text`, e.g. "Inbound lead qualified: Isar Data GmbH". */
  text: string;
  /** TEXT `detail`, e.g. "Score 84 · from the website widget". */
  detail?: string;
  /** Source Brand glyph; defaults per kind. `null` hides it. */
  source?: BrandName | null;
};

/**
 * Figma `Live event row` (02 `459:6970`): mono time, 32px kind tile, text + detail, 16px source
 * Brand glyph. Bottom border; rows stack in the Live feed card.
 */
function LiveEventRow({ className, kind, time, text, detail, source, ...props }: LiveEventRowProps) {
  const spec = LIVE_EVENT_KINDS[kind];
  const brand = source === undefined ? spec.source : source;
  return (
    <div
      data-slot="live-event-row"
      data-kind={kind}
      className={cn("flex w-full items-center gap-3 border-b border-border px-4 py-3", className)}
      {...props}
    >
      <time className="type-mono shrink-0 whitespace-nowrap text-muted-foreground">{time}</time>
      <span
        data-slot="live-event-row-tile"
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", spec.tile)}
      >
        <Icon name={spec.icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate type-body text-foreground">{text}</p>
        {detail ? <p className="truncate type-small text-muted-foreground">{detail}</p> : null}
      </div>
      {brand ? <BrandGlyph brand={brand} size={16} /> : null}
    </div>
  );
}

export { LIVE_EVENT_KINDS, LiveEventRow };
export type { LiveEventKind, LiveEventRowProps };
