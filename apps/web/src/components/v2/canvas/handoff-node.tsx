import * as React from "react";

import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";
import { initials } from "../shell/initials";
import { CanvasPort } from "./canvas-port";

type HandoffNodeProps = Omit<React.ComponentProps<"div">, "children" | "title"> & {
  state?: "default" | "selected";
  title?: string;
  /** Recipient display name, e.g. "Markus Albrecht". */
  recipient: string;
  /** Channel the recipient answers on. */
  channel?: { brand: BrandName; label: string };
  /** e.g. "Link expires after 2 h". */
  expiry: string;
  /** e.g. "Fallback: Inbox after 2 h". */
  fallback: string;
  /** Warning in place of the recipient line, e.g. "Recipient not confirmed" (07 node labels board). */
  notice?: string;
  /** Initials avatar before the recipient; off for a Team chat group. */
  avatar?: boolean;
};

/**
 * Figma `Handoff node` (02 `480:7735`): 400 x 72 human-handoff node, customer agents only.
 * Shows who answers (person + channel), link expiry and fallback. state default | selected
 * (teal border + glow, filled port). Wired from the customer agent card. `notice` swaps the
 * recipient line for a warning (Recipient not confirmed); `avatar=false` for a Team chat group.
 */
function HandoffNode({
  className,
  state = "default",
  title = "Human handoff",
  recipient,
  channel = { brand: "whatsapp", label: "WhatsApp" },
  expiry,
  fallback,
  notice,
  avatar = true,
  ...props
}: HandoffNodeProps) {
  const selected = state === "selected";
  return (
    <div
      data-slot="handoff-node"
      data-state={state}
      className={cn(
        "relative flex h-[72px] w-[400px] max-w-full items-center gap-3 rounded-xl bg-card px-3 py-2",
        selected ? "border-[1.5px] border-primary shadow-glow-primary" : "border border-border shadow-elevation-1",
        className,
      )}
      {...props}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Icon name="hand-helping" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-body-strong text-foreground">{title}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Icon name="clock" size={12} />
            <span className="whitespace-nowrap type-caption">{expiry}</span>
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {avatar ? (
            <span
              data-slot="handoff-node-avatar"
              aria-hidden
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft type-caption text-primary-soft-foreground"
            >
              {initials(recipient)}
            </span>
          ) : null}
          {notice ? (
            <span data-slot="handoff-node-notice" className="truncate type-small text-status-pending-foreground">
              {notice}
            </span>
          ) : (
            <>
              <span className="truncate type-small text-foreground">
                {avatar ? `${recipient} · ${channel.label}` : recipient}
              </span>
              <BrandGlyph brand={channel.brand} size={16} />
            </>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Icon name="inbox" size={12} />
          <span className="truncate type-caption">{fallback}</span>
        </div>
      </div>
      <CanvasPort side="right" tone={selected ? "active" : "idle"} />
    </div>
  );
}

export { HandoffNode };
export type { HandoffNodeProps };
