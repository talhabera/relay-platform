import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Chip } from "../primitives/chip";
import { Icon, type IconName } from "../primitives/icon";
import { StatusChip, type StatusTone } from "../primitives/status-chip";
import { initials } from "../shell/initials";

/** Handoff request states (human handoff spec) plus `handed-back` (auto hand-back after idle Takeover). */
type HandoffCardState = "open" | "answered" | "expired" | "taken-over" | "handed-back";

const STATE_CHIP: Record<HandoffCardState, { tone: StatusTone; label: string }> = {
  open: { tone: "needs-you", label: "Customer waiting" },
  answered: { tone: "success", label: "Answered" },
  expired: { tone: "neutral", label: "Expired" },
  "taken-over": { tone: "live", label: "Live" },
  "handed-back": { tone: "neutral", label: "Handed back" },
};

const STATUS_LINE: Partial<Record<HandoffCardState, { icon: IconName; tone: string }>> = {
  answered: { icon: "circle-check", tone: "text-status-approved-foreground" },
  expired: { icon: "clock", tone: "text-muted-foreground" },
  "taken-over": { icon: "activity", tone: "text-primary" },
  "handed-back": { icon: "bot", tone: "text-primary" },
};

type HandoffRequestCardProps = {
  className?: string;
  state: HandoffCardState;
  /** Figma `size`: desktop (sm reply Chips, md Buttons) | mobile (lg Chips stacked full width, lg Buttons). */
  size?: "desktop" | "mobile";
  /** TEXT `question`. */
  question: string;
  /** TEXT `reason`, e.g. "Why you: weekend rates are not in the price list." */
  reason?: string;
  /** TEXT `customer`, e.g. "Lukas Brenner · Isar Data GmbH". Initials come from the part before "·". */
  customer: string;
  /** Customer's channel glyph in the customer row. */
  source?: BrandName;
  /** Open: chip text, e.g. "Customer waiting 6 min". */
  waitingText?: string;
  /** Open: suggested replies (from `ask_human.suggestedReplies`). */
  suggestedReplies?: string[];
  onReply?: (reply: string) => void;
  /** Status line text per state: answered "Answered by Markus Albrecht · 11:49", expired "Link expired at 13:46", ... */
  statusText?: string;
  /** Figma TEXT `handedBackText` (alias of `statusText` for `handed-back`). */
  handedBackText?: string;
  /** taken-over: "Hand back to agent" (outline). */
  onHandBack?: () => void;
  /** handed-back: "Take over again" (primary). */
  onTakeOverAgain?: () => void;
};

const DEFAULT_STATUS_TEXT: Partial<Record<HandoffCardState, string>> = {
  answered: "Answered",
  expired: "Link expired",
  "taken-over": "You're chatting live · the agent is paused",
  "handed-back": "Handed back to the agent automatically",
};

/**
 * Figma `Handoff request card` (02 `457:61810`): state open | answered | expired | taken-over |
 * handed-back x size desktop | mobile. Primary border while the person can still act (open,
 * taken-over, handed-back). Sole owner of the card used on 11c, 08a escalated and the Live sheet.
 */
function HandoffRequestCard({
  className,
  state,
  size = "desktop",
  question,
  reason,
  customer,
  source = "website",
  waitingText,
  suggestedReplies = [],
  onReply,
  statusText,
  handedBackText,
  onHandBack,
  onTakeOverAgain,
}: HandoffRequestCardProps) {
  const mobile = size === "mobile";
  const chip = STATE_CHIP[state];
  const line = STATUS_LINE[state];
  const lineText = (state === "handed-back" ? (handedBackText ?? statusText) : statusText) ?? DEFAULT_STATUS_TEXT[state];
  const muted = state === "expired";
  const actionable = state === "open" || state === "taken-over" || state === "handed-back";
  const customerName = customer.split("·")[0];

  return (
    <article
      data-slot="handoff-request-card"
      data-state={state}
      data-size={size}
      className={cn(
        "flex w-full flex-col items-start gap-3 rounded-xl border bg-card p-4 shadow-elevation-1",
        actionable ? "border-primary" : "border-border",
        className,
      )}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="type-label text-muted-foreground">
          {state === "open" ? "Needs your answer" : "Customer question"}
        </span>
        <StatusChip tone={chip.tone}>{state === "open" ? (waitingText ?? chip.label) : chip.label}</StatusChip>
      </div>
      <h3 data-slot="handoff-request-card-question" className={cn("type-h3", muted ? "text-muted-foreground" : "text-foreground")}>
        {question}
      </h3>
      {reason ? <p className="type-small text-muted-foreground">{reason}</p> : null}
      <div data-slot="handoff-request-card-customer" className="flex w-full items-center gap-2 rounded-md bg-secondary px-3 py-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft type-caption text-primary-soft-foreground"
        >
          {initials(customerName)}
        </span>
        <span className="min-w-0 flex-1 truncate type-small text-foreground">{customer}</span>
        <BrandGlyph brand={source} size={16} />
      </div>
      {line && lineText ? (
        <p data-slot="handoff-request-card-status" className="flex w-full items-center gap-2 type-small text-foreground">
          <Icon name={line.icon} size={16} className={line.tone} />
          <span className="min-w-0 flex-1">{lineText}</span>
        </p>
      ) : null}
      {state === "open" && suggestedReplies.length > 0 ? (
        <div data-slot="handoff-request-card-replies" className="flex w-full flex-col gap-2">
          <span className="type-label text-muted-foreground">Suggested replies</span>
          <div className={cn("flex w-full gap-2", mobile ? "flex-col" : "flex-wrap")}>
            {suggestedReplies.map((reply) => (
              <Chip
                key={reply}
                size={mobile ? "lg" : "sm"}
                onClick={onReply ? () => onReply(reply) : undefined}
                className={mobile ? "h-auto min-h-11 w-full py-2 text-left whitespace-normal" : undefined}
              >
                {reply}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {state === "taken-over" && onHandBack ? (
        <Button variant="outline" size={mobile ? "lg" : "md"} onClick={onHandBack}>
          <Icon name="bot" size={16} />
          Hand back to agent
        </Button>
      ) : null}
      {state === "handed-back" && onTakeOverAgain ? (
        <Button variant="default" size={mobile ? "lg" : "md"} onClick={onTakeOverAgain}>
          <Icon name="hand-helping" size={16} />
          Take over again
        </Button>
      ) : null}
    </article>
  );
}

export { HandoffRequestCard };
export type { HandoffCardState, HandoffRequestCardProps };
