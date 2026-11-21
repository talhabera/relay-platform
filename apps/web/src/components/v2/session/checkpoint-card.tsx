import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

/** Buttons a card can show; matches the checkpoint action names the API takes. */
type CheckpointCardAction = "approve" | "ask_for_changes" | "discard" | "retry" | "refresh";

type CheckpointCardState =
  | "pending"
  | "changes-requested"
  | "approved"
  | "discarded"
  | "failed"
  | "stale"
  | "read-only";

const header: Record<CheckpointCardState, { icon: IconName; label: string; tone: string }> = {
  pending: { icon: "clipboard-check", label: "Checkpoint", tone: "text-primary" },
  "changes-requested": { icon: "message-square", label: "Changes requested", tone: "text-warning" },
  approved: { icon: "circle-check", label: "Approved", tone: "text-success" },
  discarded: { icon: "circle-x", label: "Discarded", tone: "text-muted-foreground" },
  failed: { icon: "triangle-alert", label: "Failed", tone: "text-destructive" },
  stale: { icon: "history", label: "Stale", tone: "text-muted-foreground" },
  "read-only": { icon: "clipboard-check", label: "Checkpoint", tone: "text-primary" },
};

const defaultDetail: Partial<Record<CheckpointCardState, string>> = {
  pending: "Ready for your review",
  stale: "The work changed after this was proposed",
  "read-only": "Waiting for an owner",
};

const border: Record<CheckpointCardState, string> = {
  pending: "border-primary",
  "read-only": "border-primary",
  "changes-requested": "border-border-strong",
  stale: "border-border-strong",
  approved: "border-border",
  discarded: "border-border",
  failed: "border-destructive",
};

type CheckpointCardProps = Omit<React.ComponentProps<"div">, "children" | "title"> & {
  state: CheckpointCardState;
  /** What leaves Relay, e.g. "Schedule sequence to 44 leads". */
  title: string;
  /** One line of specifics, e.g. "Starts Tue 29 Sep, 09:00 · max 40 emails a day". */
  meta?: string;
  /**
   * Header text after the state label. Pending, stale and read-only have defaults.
   * Others take who/when ("Talha Bera · 11:46") or the failure reason with time.
   */
  detail?: string;
  /** Primary label, e.g. "Approve & schedule", "Approve & post". */
  approveLabel?: string;
  /** Discard button label; defaults to "Discard". */
  discardLabel?: string;
  /** pending: one line under the card body telling the approver what to do first. */
  helper?: string;
  /** changes-requested: the operator's direction, quoted. */
  changeRequest?: string;
  /** changes-requested: progress line, e.g. "Mail Marketer is revising the draft…". */
  revisingNote?: string;
  /** approved: outcome line, e.g. "Scheduled · first send Tue 29 Sep, 09:00". */
  result?: string;
  /** discarded: closing line. */
  discardedNote?: string;
  /** read-only: why Approve is disabled. */
  lockNote?: string;
  /** The draft being signed off (email body, post text), shown verbatim. */
  preview?: string;
  /**
   * Limits the buttons to these actions (what the viewer may do on this card).
   * Omitted: every action the state offers. `retry` on `approved` is a stuck card.
   */
  actions?: readonly CheckpointCardAction[];
  /** Disables every action while a request is in flight. */
  busy?: boolean;
  onApprove?: () => void;
  /** Quotes the card into the Steering composer. */
  onAskForChanges?: () => void;
  onDiscard?: () => void;
  onRetry?: () => void;
  onRefresh?: () => void;
};

/**
 * Figma `Checkpoint card` (02 `376:24204`): anything that leaves Relay waits here.
 * pending (teal, Approve / Ask for changes / Discard), changes-requested (quoted direction),
 * approved (result), discarded (muted), failed (Retry), stale (Refresh checkpoint),
 * read-only (member without approve rights: disabled Approve + lock note).
 */
function CheckpointCard({
  className,
  state,
  title,
  meta,
  detail,
  approveLabel = "Approve",
  discardLabel = "Discard",
  helper,
  changeRequest,
  revisingNote,
  result,
  discardedNote = "Nothing was sent. The draft stays in the session.",
  lockNote = "Only owners can approve.",
  preview,
  actions: allowed,
  busy = false,
  onApprove,
  onAskForChanges,
  onDiscard,
  onRetry,
  onRefresh,
  ...props
}: CheckpointCardProps) {
  const h = header[state];
  const headerDetail = detail ?? defaultDetail[state];
  const muted = state === "discarded";

  const can = (action: CheckpointCardAction) => !allowed || allowed.includes(action);
  const askForChanges = !can("ask_for_changes") ? null : (
    <Button variant="outline" size="md" disabled={busy} onClick={onAskForChanges}>
      <Icon name="message-square" size={16} />
      Ask for changes
    </Button>
  );
  const discard = !can("discard") ? null : (
    <Button variant="ghost" size="md" disabled={busy} onClick={onDiscard}>
      {discardLabel}
    </Button>
  );

  const retry = !can("retry") ? null : (
    <Button size="md" disabled={busy} onClick={onRetry}>
      <Icon name="refresh-cw" size={16} />
      Retry
    </Button>
  );

  let actions: React.ReactNode = null;
  if (state === "pending") {
    actions = (
      <>
        {can("approve") ? (
          <Button size="md" disabled={busy} onClick={onApprove}>
            <Icon name="check" size={16} />
            {approveLabel}
          </Button>
        ) : null}
        {askForChanges}
        {discard}
      </>
    );
  } else if (state === "failed") {
    actions = (
      <>
        {retry}
        {askForChanges}
        {discard}
      </>
    );
  } else if (state === "approved" && allowed?.includes("retry")) {
    actions = retry;
  } else if (state === "stale") {
    actions = (
      <>
        {can("refresh") ? (
          <Button variant="outline" size="md" disabled={busy} onClick={onRefresh}>
            <Icon name="refresh-cw" size={16} />
            Refresh checkpoint
          </Button>
        ) : null}
        {discard}
      </>
    );
  } else if (state === "read-only") {
    actions = (
      <Button size="md" disabled>
        <Icon name="lock" size={16} />
        {approveLabel}
      </Button>
    );
  }

  return (
    <div
      data-slot="checkpoint-card"
      data-state={state}
      aria-busy={busy || undefined}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-3 rounded-xl border bg-surface-raised p-4 shadow-elevation-1",
        border[state],
        className,
      )}
      {...props}
    >
      <div data-slot="checkpoint-header" className="flex min-w-0 max-w-full items-center gap-2">
        <Icon name={h.icon} size={18} className={h.tone} />
        <span className={cn("shrink-0 whitespace-nowrap type-label uppercase", h.tone)}>{h.label}</span>
        {headerDetail ? (
          <span
            className={cn(
              "truncate type-caption",
              state === "pending" ? "text-primary" : "text-muted-foreground",
            )}
          >
            {headerDetail}
          </span>
        ) : null}
      </div>
      <p className={cn("w-full type-h3", muted ? "text-muted-foreground" : "text-foreground")}>{title}</p>
      {meta ? <p className="w-full type-small text-muted-foreground">{meta}</p> : null}
      {preview ? (
        <p
          data-slot="checkpoint-preview"
          className="w-full whitespace-pre-wrap rounded-lg border border-border bg-muted px-3 py-2 type-small text-foreground"
        >
          {preview}
        </p>
      ) : null}
      {state === "pending" && helper ? (
        <p data-slot="checkpoint-helper" className="w-full type-small text-muted-foreground">
          {helper}
        </p>
      ) : null}

      {state === "changes-requested" && changeRequest ? (
        <div data-slot="checkpoint-quote" className="flex w-full items-stretch gap-3">
          <span aria-hidden className="w-0.5 shrink-0 bg-warning" />
          <q className="min-w-0 flex-1 type-small text-foreground">{changeRequest}</q>
        </div>
      ) : null}
      {state === "changes-requested" && revisingNote ? (
        <p className="type-caption text-muted-foreground">{revisingNote}</p>
      ) : null}

      {state === "approved" && result ? (
        <div data-slot="checkpoint-result" className="flex items-center gap-2">
          <Icon name="calendar-clock" size={16} className="text-muted-foreground" />
          <span className="type-small text-foreground">{result}</span>
        </div>
      ) : null}

      {muted ? <p className="type-small text-muted-foreground">{discardedNote}</p> : null}

      {hasContent(actions) ? (
        <div data-slot="checkpoint-actions" className="flex w-full flex-wrap items-center gap-x-1 gap-y-2">
          {actions}
        </div>
      ) : null}

      {state === "read-only" ? (
        <div data-slot="checkpoint-lock" className="flex items-center gap-2">
          <Icon name="lock" size={16} className="text-muted-foreground" />
          <span className="type-caption text-muted-foreground">{lockNote}</span>
        </div>
      ) : null}
    </div>
  );
}

/** False for null and for a fragment whose children all rendered nothing. */
function hasContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || node === false) return false;
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === React.Fragment) {
    return React.Children.toArray(node.props.children).length > 0;
  }
  return true;
}

export { CheckpointCard };
export type { CheckpointCardAction, CheckpointCardProps, CheckpointCardState };
