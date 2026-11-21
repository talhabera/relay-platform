import type { CheckpointPayload, CheckpointStatus } from "@/db/schema";
import {
  availableCheckpointActions,
  isPersistRetryable,
  isStuckApproved,
  type CheckpointAction,
} from "@/lib/operator/approvals";
import { REFRESH_RETRY_MS } from "@/lib/operator/resolve-action";

// What one viewer sees on one Checkpoint card (S45, Figma 06 `1:7`). The
// server builds it from the row and the viewer's approve rights; the client
// only renders it and posts the actions it lists.

/** The v2 CheckpointCard state names. */
export type CheckpointCardViewState =
  | "pending"
  | "changes-requested"
  | "approved"
  | "discarded"
  | "failed"
  | "stale"
  | "read-only";

export type CheckpointCardView = {
  id: string;
  kind: CheckpointPayload["kind"];
  status: CheckpointStatus;
  state: CheckpointCardViewState;
  title: string;
  meta?: string;
  /** The draft text the approver signs off on (outreach body, reply, post). */
  preview?: string;
  detail?: string;
  approveLabel: string;
  /** Overrides the default Discard label (manual ad change: "Uygulamadım"). */
  discardLabel?: string;
  /** One line under the card telling the approver what to do first. */
  helper?: string;
  changeRequest?: string;
  result?: string;
  /** Actions this viewer may post; empty for non-approvers and closed cards. */
  actions: CheckpointAction[];
  canApprove: boolean;
  /** A Refresh is already waiting on the agent (Refresh is idempotent). */
  refreshRequested: boolean;
  superseded: boolean;
};

/**
 * A customer conversation has no agent loop answering on it (W3GAP2), so Ask
 * for changes and Refresh have nobody to act. Mirrors the route's allow-list.
 */
const CUSTOMER_CHAT_ACTIONS: ReadonlySet<CheckpointAction> = new Set([
  "approve",
  "discard",
  "retry",
]);

export type CheckpointCardRow = {
  id: string;
  status: CheckpointStatus;
  payload: CheckpointPayload;
  executeResult: Record<string, unknown> | null;
  resolvedAt: Date | null;
  attemptCount: number;
  supersededBy: string | null;
  refreshRequestedAt: Date | null;
};

export function checkpointCardView(
  row: CheckpointCardRow,
  viewer: { canApprove: boolean; onCustomerChat?: boolean; now?: Date },
): CheckpointCardView {
  const now = viewer.now ?? new Date();
  const result = row.executeResult ?? null;
  const persistRetry = isPersistRetryable({
    status: row.status,
    kind: row.payload.kind,
    executeResult: result,
  });
  const stuck = isStuckApproved(row, now) || persistRetry;
  let actions = availableCheckpointActions(
    row.status,
    viewer.canApprove,
    row.supersededBy,
    stuck,
  );
  if (viewer.onCustomerChat) {
    actions = actions.filter((action) => CUSTOMER_CHAT_ACTIONS.has(action));
  }

  const refreshRequested =
    row.refreshRequestedAt !== null &&
    now.getTime() - row.refreshRequestedAt.getTime() < REFRESH_RETRY_MS;

  const copy = payloadCopy(row.payload);
  const view: CheckpointCardView = {
    id: row.id,
    kind: row.payload.kind,
    status: row.status,
    state: cardState(row.status, viewer.canApprove, row.supersededBy),
    title: copy.title,
    approveLabel: copy.approveLabel,
    actions,
    canApprove: viewer.canApprove,
    refreshRequested,
    superseded: row.supersededBy !== null,
  };
  if (copy.meta) view.meta = copy.meta;
  if (copy.preview) view.preview = copy.preview;
  if (copy.discardLabel) view.discardLabel = copy.discardLabel;
  if (copy.helper) view.helper = copy.helper;

  const error = stringOf(result, "error");
  switch (row.status) {
    case "failed":
      view.detail = withAttempt(error ?? "The action did not run", row.attemptCount);
      break;
    case "stale":
      if (refreshRequested) {
        view.detail = "Refresh requested. The agent is drafting a new card.";
      } else if (row.supersededBy) {
        view.detail = "Replaced by a newer card";
      }
      break;
    case "changes_requested": {
      const feedback = stringOf(result, "feedback");
      if (feedback) view.changeRequest = feedback;
      break;
    }
    case "approved": {
      const persistError = stringOf(result, "persistError");
      if (persistError) {
        view.detail = `Sent, but recording it failed: ${persistError}`;
      } else if (result === null) {
        view.detail = stuck
          ? "No result came back. Retry runs it again safely."
          : "Running…";
      }
      view.result = approvedResult(row.payload, result);
      break;
    }
    case "discarded":
      if (row.payload.kind === "ad_change" && result?.status === "expired") {
        view.result = "Süresi doldu: 24 saat içinde yanıtlanmadı, uygulanmadı";
      }
      break;
    default:
      break;
  }
  return view;
}

function cardState(
  status: CheckpointStatus,
  canApprove: boolean,
  supersededBy: string | null,
): CheckpointCardViewState {
  switch (status) {
    case "pending":
      // Read-only (Figma state 07) is a pending card the viewer cannot act on.
      return canApprove && !supersededBy ? "pending" : "read-only";
    case "changes_requested":
      return "changes-requested";
    default:
      return status;
  }
}

type PayloadCopy = {
  title: string;
  meta?: string;
  preview?: string;
  approveLabel: string;
  discardLabel?: string;
  helper?: string;
};

function payloadCopy(payload: CheckpointPayload): PayloadCopy {
  switch (payload.kind) {
    case "lead_delivery":
      return {
        title: `Deliver lead: ${payload.summary}`,
        meta: `${channelLabel(payload.channel)} · ${payload.recipient} · ${payload.reason}`,
        approveLabel: "Approve & send",
      };
    case "outreach":
      return {
        title: `Send to ${payload.recordName}`,
        meta: [channelLabel(payload.channel), payload.recipient, payload.subject]
          .filter(Boolean)
          .join(" · "),
        preview: payload.body,
        approveLabel: "Approve",
      };
    case "email_sequence":
      return {
        title: `Schedule ${payload.steps.length}-step sequence to ${payload.recordName}`,
        meta: payload.recipient,
        approveLabel: "Approve & schedule",
      };
    case "post":
      return {
        title: `Post to ${channelLabel(payload.channel)}`,
        meta: payload.scheduledFor ? `Scheduled for ${payload.scheduledFor}` : payload.reason,
        preview: payload.body,
        approveLabel: "Approve & post",
      };
    case "review_reply":
      return {
        title: `Reply to ${payload.reviewerName}'s review`,
        meta: `${payload.rating}★ · ${payload.reviewText}`,
        preview: payload.body,
        approveLabel: "Approve & reply",
      };
    case "ad_change":
      return adChangeCopy(payload);
    default: {
      const exhaustive: never = payload;
      return { title: String((exhaustive as { kind?: unknown }).kind), approveLabel: "Approve" };
    }
  }
}

function approvedResult(
  payload: CheckpointPayload,
  result: Record<string, unknown> | null,
): string | undefined {
  if (result === null) return undefined;
  switch (payload.kind) {
    case "lead_delivery":
      return `Sent to ${payload.recipient}`;
    case "outreach":
      return result.mode === "copy" ? "Approved · copy the draft and send it" : "Sent";
    case "ad_change":
      if (payload.executionMode === "manual") return "Uygulandı olarak kaydedildi";
      return payload.mode === "undo" ? "Geri alındı" : "Uygulandı";
    default:
      return "Done";
  }
}

// ---------------------------------------------------------------------------
// Ad change copy (08b2). Turkish: the cards are read by the agency owner.
// ---------------------------------------------------------------------------

type AdChangeCardPayload = Extract<CheckpointPayload, { kind: "ad_change" }>;

const AD_PLATFORM_LABELS: Record<string, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
};

const TL_FORMAT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/** TRY minor units (kuruş) as "1.200 TL". */
export function formatTl(minor: number): string {
  return `${TL_FORMAT.format(minor / 100)} TL`;
}

function budgetOf(value: unknown): number | null {
  const v = (value as { dailyBudgetMinor?: unknown } | null)?.dailyBudgetMinor;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** "Günlük bütçe 500 TL → 600 TL" on a card, "Günlük bütçe 500 TL, 600 TL olsun" as a panel instruction. */
function adChangeLine(payload: AdChangeCardPayload, style: "arrow" | "instruction"): string {
  const command = payload.command;
  switch (command.action) {
    case "set_daily_budget": {
      const before = budgetOf(payload.before) ?? command.observed?.dailyBudgetMinor ?? null;
      const after = formatTl(command.afterMinor);
      if (before === null) return style === "arrow" ? `Günlük bütçe → ${after}` : `Günlük bütçe ${after} olsun`;
      return style === "arrow"
        ? `Günlük bütçe ${formatTl(before)} → ${after}`
        : `Günlük bütçe ${formatTl(before)}, ${after} olsun`;
    }
    case "pause":
      return style === "arrow" ? "Durum: açık → duraklatıldı" : "Kampanyayı duraklat";
    case "resume":
      return style === "arrow" ? "Durum: duraklatıldı → açık" : "Kampanyayı yeniden başlat";
    case "add_keyword":
      return `Anahtar kelime ekle: "${command.keyword}" (${command.matchType})`;
    case "add_negative_keyword":
      return `Negatif anahtar kelime ekle: "${command.keyword}" (${command.matchType})`;
    case "update_ad_copy":
      return `Reklam metnini güncelle: ${command.headlines.length} başlık, ${command.descriptions.length} açıklama`;
  }
}

function adReasonLine(reason: AdChangeCardPayload["reason"]): string | null {
  if (!reason.metric || reason.value == null) return null;
  return reason.threshold == null
    ? `${reason.metric} ${reason.value}`
    : `${reason.metric} ${reason.value} (eşik ${reason.threshold})`;
}

function adChangeCopy(payload: AdChangeCardPayload): PayloadCopy {
  const platform = AD_PLATFORM_LABELS[payload.platform] ?? payload.platform;
  const undo = payload.mode === "undo";
  const title = `${undo ? "Reklam değişikliğini geri al" : "Reklam değişikliği"}: ${payload.campaignName}`;
  const meta = [
    platform,
    payload.campaignName,
    adChangeLine(payload, "arrow"),
    `Günlük toplam ${formatTl(payload.dailyTotalAfterMinor)}`,
    adReasonLine(payload.reason),
  ]
    .filter(Boolean)
    .join(" · ");

  if (payload.executionMode === "manual") {
    return {
      title,
      meta,
      preview: [
        `Reklam panelinde şunu yap: ${platform} · ${payload.campaignName} · ${adChangeLine(payload, "instruction")}`,
        `Neden: ${payload.reason.text}`,
      ].join("\n"),
      approveLabel: "Uygulandı",
      discardLabel: "Uygulamadım",
      helper:
        "Önce reklam panelinde değiştir, sonra Uygulandı'ya bas. Panelde şu anki değer farklıysa Uygulamadım'a bas.",
    };
  }
  return {
    title,
    meta,
    preview: payload.reason.text,
    approveLabel: undo ? "Geri al" : "Uygula",
  };
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  webhook: "Webhook",
  copy: "Copy",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  gbp: "Google Business Profile",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function withAttempt(text: string, attempt: number): string {
  return attempt > 1 ? `${text} · attempt ${attempt}` : text;
}

function stringOf(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
