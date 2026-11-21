"use client";

import { useCallback, useEffect, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import { CheckpointCard, SteeringComposer } from "@/components/v2/session";
import { getPendingAction } from "@/lib/operator/pending-action";
import type { CheckpointAction } from "@/lib/operator/approvals";
import type { CheckpointCardView } from "@/lib/operator/checkpoint-card-view";

// Live Checkpoint cards (S45, Figma 06 `1:7`): the v2 card fed by
// GET /api/operator/checkpoints, acting through the existing action routes
// (sessions and customer chats: /api/operator/actions/:id, Schedule runs:
// /api/operator/cron/actions/:id). Replaces pending-approval-block.

export type CheckpointSource = { chatId: string } | { runId: string };

export type CheckpointCards = {
  byId: ReadonlyMap<string, CheckpointCardView>;
  list: CheckpointCardView[];
  busyId: string | null;
  onAction: (id: string, action: CheckpointAction, feedback?: string) => void;
  /** Set by a session: Ask for changes quotes the card in its Steering composer. */
  askForChanges?: (view: CheckpointCardView) => void;
};

function toolOutput(part: UIMessage["parts"][number]): unknown {
  if (!isToolUIPart(part)) return undefined;
  if (part.state !== "output-available" && part.state !== "input-available") {
    return undefined;
  }
  return "output" in part ? part.output : undefined;
}

/** The tool part carries a proposed card (rendered by CheckpointBlock). */
export function hasPendingCard(part: UIMessage["parts"][number]): boolean {
  return Boolean(getPendingAction(toolOutput(part)));
}

function checkpointsUrl(source: CheckpointSource): string {
  return "chatId" in source
    ? `/api/operator/checkpoints?chatId=${encodeURIComponent(source.chatId)}`
    : `/api/operator/checkpoints?runId=${encodeURIComponent(source.runId)}`;
}

function actionUrl(source: CheckpointSource, id: string): string {
  return "runId" in source
    ? `/api/operator/cron/actions/${id}`
    : `/api/operator/actions/${id}`;
}

/**
 * Loads the cards for a session, customer chat or Schedule run, and posts
 * actions. `reloadKey` refetches when it changes (a new card may have
 * arrived). `onResolved` runs after a successful action.
 */
export function useCheckpointCards(
  source: CheckpointSource,
  options: {
    reloadKey?: unknown;
    onResolved?: (action: CheckpointAction, status: string) => void;
  } = {},
): CheckpointCards {
  const { reloadKey, onResolved } = options;
  const url = checkpointsUrl(source);
  const [list, setList] = useState<CheckpointCardView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { checkpoints: CheckpointCardView[] };
      setList(body.checkpoints);
    } catch {
      // Keep the last list; the next reload retries.
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  const sourceKey = "chatId" in source ? source.chatId : source.runId;
  const isRun = "runId" in source;

  const onAction = useCallback(
    (id: string, action: CheckpointAction, feedback?: string) => {
      const target = isRun ? { runId: sourceKey } : { chatId: sourceKey };
      const card = list.find((c) => c.id === id);
      setBusyId(id);
      void (async () => {
        try {
          const res = await fetch(actionUrl(target, id), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(feedback ? { action, feedback } : { action }),
          });
          const body = (await res.json().catch(() => ({}))) as { status?: string };
          if (res.status === 409) {
            toast.info("This checkpoint changed. Showing the latest.");
          } else if (res.status === 403) {
            toast.error("You can't act on this checkpoint");
          } else if (!res.ok) {
            toast.error("Failed to process the checkpoint");
          } else {
            resolvedToast(action, body.status, card);
            onResolved?.(action, body.status ?? "");
          }
        } catch {
          toast.error("Failed to process the checkpoint");
        } finally {
          setBusyId(null);
          await reload();
        }
      })();
    },
    [isRun, sourceKey, list, reload, onResolved],
  );

  const byId = new Map(list.map((card) => [card.id, card]));
  return { byId, list, busyId, onAction };
}

function resolvedToast(
  action: CheckpointAction,
  status: string | undefined,
  card: CheckpointCardView | undefined,
) {
  const title = card?.title;
  if (status === "failed") {
    toast.error("Approved, but it did not run", {
      description: "Retry from the card.",
    });
    return;
  }
  switch (action) {
    case "approve":
    case "retry":
      // Figma 06 `checkpoint/approved-toast`.
      toast.success("Approved", title ? { description: title } : undefined);
      return;
    case "discard":
      toast.success("Discarded. Nothing was sent.");
      return;
    case "ask_for_changes":
      toast.success("Changes requested");
      return;
    case "refresh":
      toast.success("Refresh requested");
      return;
  }
}

/** A card proposed in a transcript tool part, shown with its live state. */
export function CheckpointBlock({
  part,
  cards,
}: {
  part: UIMessage["parts"][number];
  cards: CheckpointCards;
}) {
  const proposed = getPendingAction(toolOutput(part));
  if (!proposed) return null;

  const view: CheckpointCardView = cards.byId.get(proposed.pendingId) ?? {
    // Until the live state loads: the proposal as the agent posted it, no buttons.
    id: proposed.pendingId,
    kind: "outreach",
    status: "pending",
    state: "pending",
    title: `Send to ${proposed.recordName}`,
    meta: [proposed.channel, proposed.recipient, proposed.subject]
      .filter(Boolean)
      .join(" · "),
    preview: proposed.body,
    approveLabel: "Approve",
    actions: [],
    canApprove: false,
    refreshRequested: false,
    superseded: false,
  };

  return (
    <LiveCheckpointCard
      view={view}
      busy={cards.busyId === view.id}
      onAction={cards.onAction}
      onAskForChanges={cards.askForChanges}
    />
  );
}

/**
 * The v2 card for one view. Ask for changes quotes the card in the session's
 * Steering composer when `onAskForChanges` is given; elsewhere (Inbox,
 * Schedule runs) a quoting Steering composer opens under the card.
 */
export function LiveCheckpointCard({
  view,
  busy,
  onAction,
  onAskForChanges,
}: {
  view: CheckpointCardView;
  busy: boolean;
  onAction: CheckpointCards["onAction"];
  onAskForChanges?: (view: CheckpointCardView) => void;
}) {
  const [asking, setAsking] = useState(false);

  const detail = view.detail;
  return (
    <div className="flex w-full flex-col gap-2">
      <CheckpointCard
        state={view.state}
        title={view.title}
        meta={view.meta}
        preview={view.preview}
        detail={detail}
        approveLabel={view.approveLabel}
        discardLabel={view.discardLabel}
        helper={view.helper}
        changeRequest={view.changeRequest}
        result={view.result}
        lockNote="Only the owner or an approver on this agent can approve."
        actions={view.actions}
        busy={busy}
        onApprove={() => onAction(view.id, "approve")}
        onDiscard={() => onAction(view.id, "discard")}
        onRetry={() => onAction(view.id, "retry")}
        onRefresh={() => onAction(view.id, "refresh")}
        onAskForChanges={() => (onAskForChanges ? onAskForChanges(view) : setAsking(true))}
      />
      {!onAskForChanges && asking && view.actions.includes("ask_for_changes") ? (
        <CheckpointChangeRequest
          view={view}
          busy={busy}
          onSend={(text) => {
            onAction(view.id, "ask_for_changes", text);
            setAsking(false);
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}

/** Ask for changes outside a session: a Steering composer quoting the card. */
export function CheckpointChangeRequest({
  view,
  busy,
  onSend,
  onCancel,
}: {
  view: CheckpointCardView;
  busy: boolean;
  onSend: (feedback: string) => void;
  onCancel: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  return (
    <SteeringComposer
      value={feedback}
      onChange={(value) => setFeedback(value.slice(0, MAX_FEEDBACK))}
      onSubmit={(text) => {
        if (busy) return;
        onSend(text);
        setFeedback("");
      }}
      quote={{ text: view.title }}
      onRemoveQuote={() => {
        setFeedback("");
        onCancel();
      }}
    />
  );
}

/** The action route caps feedback at 4000 characters (checkpoint-actions.ts). */
const MAX_FEEDBACK = 4000;

const OPEN_STATES: ReadonlySet<string> = new Set(["pending", "stale", "failed"]);

/** The card with this id, when the viewer may act on it; else null. */
export function approvableCard(
  list: readonly CheckpointCardView[],
  id: string,
): CheckpointCardView | null {
  const card = list.find((c) => c.id === id);
  return card && card.canApprove && !card.superseded ? card : null;
}

/**
 * One customer-chat checkpoint in the /needs-you detail pane (W5GAP), for
 * approvers who may lack Inbox access. Same data and action routes as the
 * Inbox (/api/operator/checkpoints, /api/operator/actions/:id). Renders
 * nothing until loaded, or when the viewer cannot approve.
 */
export function NeedsYouCheckpoint({
  chatId,
  checkpointId,
}: {
  chatId: string;
  checkpointId: string;
}) {
  const cards = useCheckpointCards({ chatId });
  const view = approvableCard(cards.list, checkpointId);
  if (!view) return null;
  return (
    <section aria-label="Checkpoint" data-slot="needs-you-checkpoint">
      <LiveCheckpointCard
        view={view}
        busy={cards.busyId === view.id}
        onAction={cards.onAction}
      />
    </section>
  );
}

/**
 * Checkpoint cards on a customer conversation (W3GAP2: lead_delivery on the
 * lead's own chat). Approvers get Approve / Discard (and Retry on a failed or
 * stuck card); everyone else sees the read-only card. Shows open cards plus
 * any the viewer resolved here, so the approved state stays in view.
 */
export function CustomerChatCheckpoints({ chatId }: { chatId: string }) {
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const cards = useCheckpointCards({ chatId });
  const visible = cards.list.filter(
    (card) =>
      !card.superseded &&
      (OPEN_STATES.has(card.status) ||
        card.actions.length > 0 ||
        touched.has(card.id)),
  );
  if (visible.length === 0) return null;

  const onAction: CheckpointCards["onAction"] = (id, action, feedback) => {
    setTouched((prev) => new Set(prev).add(id));
    cards.onAction(id, action, feedback);
  };

  return (
    <section
      aria-label="Checkpoints"
      data-slot="customer-chat-checkpoints"
      className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto border-b bg-background p-4"
    >
      {visible.map((view) => (
        <LiveCheckpointCard
          key={view.id}
          view={view}
          busy={cards.busyId === view.id}
          onAction={onAction}
        />
      ))}
    </section>
  );
}
