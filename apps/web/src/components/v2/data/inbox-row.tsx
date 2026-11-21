import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";
import { StatusChip, type StatusTone } from "../primitives/status-chip";
import { initials } from "../shell/initials";

type InboxRowState = "default" | "selected" | "unread" | "escalated";

/** Handoff state shown on an escalated row (Figma description: Handed off | Answered | Expired | Taken over). */
type InboxHandoffState = "handed-off" | "answered" | "expired" | "taken-over";

const HANDOFF_CHIP: Record<InboxHandoffState, { tone: StatusTone; label: string }> = {
  "handed-off": { tone: "neutral", label: "Handed off" },
  answered: { tone: "success", label: "Answered" },
  expired: { tone: "needs-you", label: "Expired" },
  "taken-over": { tone: "live", label: "Taken over" },
};

type InboxRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  state?: InboxRowState;
  customer: string;
  /** Source channel glyph next to the customer name. */
  source?: BrandName;
  /** Preformatted time, e.g. "11:42". */
  time: string;
  /** Agent line: the customer agent, or "Handed to <name>" on escalated rows. */
  agent: string;
  snippet: string;
  /** Figma BOOLEAN `handoff`: hand-helping icon on the agent line of a non-escalated row. */
  handoff?: boolean;
  /** Escalated rows: handoff chip. Default `handed-off`. */
  handoffState?: InboxHandoffState;
  /** Non-escalated rows: conversation chip. Default live "Open". */
  status?: { tone: StatusTone; label: string };
};

/**
 * Figma `Inbox row` (02 `378:28147`): read-only Inbox list row for customer-agent conversations.
 * state default | selected (primary-soft fill, primary border) | unread (dot, bold snippet) |
 * escalated (handed to a person via human handoff).
 */
function InboxRow({
  className,
  state = "default",
  customer,
  source = "website",
  time,
  agent,
  snippet,
  handoff = false,
  handoffState = "handed-off",
  status = { tone: "live", label: "Open" },
  ...props
}: InboxRowProps) {
  const escalated = state === "escalated";
  const chip = escalated ? HANDOFF_CHIP[handoffState] : status;
  return (
    <div
      data-slot="inbox-row"
      data-state={state}
      aria-selected={state === "selected" || undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-4",
        state === "selected" ? "border-primary bg-primary-soft" : "border-border bg-card",
        className,
      )}
      {...props}
    >
      <Avatar size="md">
        <AvatarFallback>{initials(customer)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex w-full items-center gap-2 overflow-hidden">
          <span className="truncate type-body-strong text-foreground">{customer}</span>
          <BrandGlyph brand={source} size={16} />
          <span className="min-w-0 flex-1" />
          {state === "unread" ? (
            <span data-slot="inbox-row-unread" aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary" />
          ) : null}
          <span className="shrink-0 type-caption text-muted-foreground">{time}</span>
        </div>
        <div data-slot="inbox-row-agent" className="flex items-center gap-1 overflow-hidden">
          {escalated || handoff ? (
            <Icon name="hand-helping" size={14} className="text-primary" data-slot="inbox-row-handoff" />
          ) : null}
          <span className="truncate type-caption text-muted-foreground">{agent}</span>
        </div>
        <div className="flex w-full items-center gap-2 overflow-hidden">
          <span
            data-slot="inbox-row-snippet"
            className={cn("min-w-0 flex-1 truncate type-small", state === "unread" ? "text-foreground" : "text-muted-foreground")}
          >
            {snippet}
          </span>
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </div>
      </div>
    </div>
  );
}

export { InboxRow };
export type { InboxHandoffState, InboxRowProps, InboxRowState };
