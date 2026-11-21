import { describe, expect, it } from "vitest";
import {
  checkpointCardView,
  type CheckpointCardRow,
} from "@/lib/operator/checkpoint-card-view";

const now = new Date("2026-10-03T10:00:00.000Z");

const delivery: CheckpointCardRow = {
  id: "cp-1",
  status: "pending",
  payload: {
    kind: "lead_delivery",
    leadId: "lead-1",
    channel: "whatsapp",
    recipient: "+905551112233",
    summary: "Ayse, villa, May",
    reason: "Qualified inbound lead, fit 82",
  },
  executeResult: null,
  resolvedAt: null,
  attemptCount: 1,
  supersededBy: null,
  refreshRequestedAt: null,
};

const outreach: CheckpointCardRow = {
  ...delivery,
  id: "cp-2",
  payload: {
    kind: "outreach",
    channel: "email",
    recipient: "ops@acme.test",
    subject: "Hello",
    body: "Hi there",
    reason: "Fits the ICP",
    recordName: "Acme",
    domain: "acme.test",
  },
};

describe("checkpointCardView", () => {
  it("lead delivery on a customer chat: approver gets Approve and Discard only", () => {
    const view = checkpointCardView(delivery, {
      canApprove: true,
      onCustomerChat: true,
      now,
    });
    expect(view.state).toBe("pending");
    expect(view.actions).toEqual(["approve", "discard"]);
    expect(view.title).toContain("Ayse, villa, May");
    expect(view.meta).toContain("WhatsApp");
    expect(view.approveLabel).toBe("Approve & send");
  });

  it("non-approver sees a read-only pending card with no actions", () => {
    const view = checkpointCardView(delivery, {
      canApprove: false,
      onCustomerChat: true,
      now,
    });
    expect(view.state).toBe("read-only");
    expect(view.actions).toEqual([]);
  });

  it("non-approver on a failed card: failed state, no Retry", () => {
    const view = checkpointCardView(
      { ...delivery, status: "failed", executeResult: { error: "Worker down" } },
      { canApprove: false, now },
    );
    expect(view.state).toBe("failed");
    expect(view.actions).toEqual([]);
    expect(view.detail).toBe("Worker down");
  });

  it("operator session pending: approve, ask for changes, discard", () => {
    const view = checkpointCardView(outreach, { canApprove: true, now });
    expect(view.actions).toEqual(["approve", "ask_for_changes", "discard"]);
    expect(view.preview).toBe("Hi there");
  });

  it("failed with attempts: Retry offered, attempt in the detail", () => {
    const view = checkpointCardView(
      {
        ...delivery,
        status: "failed",
        attemptCount: 2,
        executeResult: { error: "Timed out" },
      },
      { canApprove: true, onCustomerChat: true, now },
    );
    expect(view.actions).toEqual(["retry", "discard"]);
    expect(view.detail).toBe("Timed out · attempt 2");
  });

  it("stuck approved card offers the existing Retry", () => {
    const view = checkpointCardView(
      {
        ...delivery,
        status: "approved",
        resolvedAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
      { canApprove: true, onCustomerChat: true, now },
    );
    expect(view.state).toBe("approved");
    expect(view.actions).toEqual(["retry"]);
  });

  it("approved lead delivery whose bookkeeping failed offers Retry", () => {
    const view = checkpointCardView(
      {
        ...delivery,
        status: "approved",
        resolvedAt: now,
        executeResult: { sent: true, persistError: "db down" },
      },
      { canApprove: true, onCustomerChat: true, now },
    );
    expect(view.actions).toEqual(["retry"]);
    expect(view.detail).toContain("db down");
  });

  it("approved with a result: no actions, result line", () => {
    const view = checkpointCardView(
      { ...delivery, status: "approved", resolvedAt: now, executeResult: { sent: true } },
      { canApprove: true, now },
    );
    expect(view.actions).toEqual([]);
    expect(view.result).toBe("Sent to +905551112233");
  });

  it("stale with a Refresh in flight says so; Refresh stays (idempotent)", () => {
    const view = checkpointCardView(
      {
        ...outreach,
        status: "stale",
        refreshRequestedAt: new Date(now.getTime() - 60 * 1000),
      },
      { canApprove: true, now },
    );
    expect(view.state).toBe("stale");
    expect(view.refreshRequested).toBe(true);
    expect(view.actions).toEqual(["discard", "refresh"]);
  });

  it("stale on a customer chat: Discard only (nobody answers a Refresh)", () => {
    const view = checkpointCardView(
      { ...delivery, status: "stale" },
      { canApprove: true, onCustomerChat: true, now },
    );
    expect(view.actions).toEqual(["discard"]);
  });

  it("changes requested quotes the feedback", () => {
    const view = checkpointCardView(
      {
        ...outreach,
        status: "changes_requested",
        executeResult: { status: "changes_requested", feedback: "Shorter" },
      },
      { canApprove: true, now },
    );
    expect(view.state).toBe("changes-requested");
    expect(view.changeRequest).toBe("Shorter");
    expect(view.actions).toEqual([]);
  });

  it("superseded cards are closed", () => {
    const view = checkpointCardView(
      { ...outreach, status: "stale", supersededBy: "cp-9" },
      { canApprove: true, now },
    );
    expect(view.actions).toEqual([]);
    expect(view.superseded).toBe(true);
  });
});

describe("ad_change card (08b2)", () => {
  const adPayload = {
    kind: "ad_change" as const,
    mode: "change" as const,
    changeId: "chg-1",
    platform: "google" as const,
    accountId: "acc-1",
    campaignId: "cmp-1",
    campaignName: "Villa Kampanyası",
    command: {
      platform: "google" as const,
      accountId: "acc-1",
      campaignId: "cmp-1",
      action: "set_daily_budget" as const,
      afterMinor: 60_000,
      observed: { campaignName: "Villa Kampanyası", status: "enabled" as const, dailyBudgetMinor: 50_000 },
    },
    before: { dailyBudgetMinor: 50_000 },
    after: { dailyBudgetMinor: 60_000 },
    deltaMinor: 10_000,
    dailyTotalAfterMinor: 120_000,
    reason: { text: "CPL hedefin altında", metric: "cpl", value: 80, threshold: 100 },
    expiresAt: "2026-10-04T10:00:00.000Z",
    executionMode: "api" as const,
  };
  const change: CheckpointCardRow = { ...delivery, id: "cp-ad", payload: adPayload };
  const undo: CheckpointCardRow = {
    ...change,
    payload: {
      ...adPayload,
      mode: "undo",
      reversesChangeId: "chg-0",
      command: { ...adPayload.command, afterMinor: 50_000 },
      before: { dailyBudgetMinor: 60_000 },
      after: { dailyBudgetMinor: 50_000 },
    },
  };
  const manual: CheckpointCardRow = {
    ...change,
    payload: { ...adPayload, executionMode: "manual" },
  };

  it("change card: title, meta and Uygula", () => {
    const view = checkpointCardView(change, { canApprove: true, now });
    expect(view.title).toBe("Reklam değişikliği: Villa Kampanyası");
    expect(view.meta).toBe(
      "Google Ads · Villa Kampanyası · Günlük bütçe 500 TL → 600 TL · Günlük toplam 1.200 TL · cpl 80 (eşik 100)",
    );
    expect(view.preview).toBe("CPL hedefin altında");
    expect(view.approveLabel).toBe("Uygula");
    expect(view.discardLabel).toBeUndefined();
  });

  it("undo card: Geri al", () => {
    const view = checkpointCardView(undo, { canApprove: true, now });
    expect(view.title).toBe("Reklam değişikliğini geri al: Villa Kampanyası");
    expect(view.meta).toContain("Günlük bütçe 600 TL → 500 TL");
    expect(view.approveLabel).toBe("Geri al");
  });

  it("manual card: panel instruction, Uygulandı / Uygulamadım and the helper", () => {
    const view = checkpointCardView(manual, { canApprove: true, now });
    expect(view.preview?.startsWith("Reklam panelinde şunu yap:")).toBe(true);
    expect(view.preview).toContain("Google Ads · Villa Kampanyası · Günlük bütçe 500 TL, 600 TL olsun");
    expect(view.approveLabel).toBe("Uygulandı");
    expect(view.discardLabel).toBe("Uygulamadım");
    expect(view.helper).toBe(
      "Önce reklam panelinde değiştir, sonra Uygulandı'ya bas. Panelde şu anki değer farklıysa Uygulamadım'a bas.",
    );
  });

  it("approved result text: applied, undone, manual", () => {
    const approved = { status: "approved" as const, executeResult: { outcome: "applied" }, resolvedAt: now };
    expect(checkpointCardView({ ...change, ...approved }, { canApprove: true, now }).result).toBe("Uygulandı");
    expect(checkpointCardView({ ...undo, ...approved }, { canApprove: true, now }).result).toBe("Geri alındı");
    expect(checkpointCardView({ ...manual, ...approved }, { canApprove: true, now }).result).toBe(
      "Uygulandı olarak kaydedildi",
    );
  });

  it("expired card says it was not applied", () => {
    const view = checkpointCardView(
      { ...change, status: "discarded", executeResult: { status: "expired" }, resolvedAt: now },
      { canApprove: true, now },
    );
    expect(view.result).toBe("Süresi doldu: 24 saat içinde yanıtlanmadı, uygulanmadı");
    expect(view.actions).toEqual([]);
  });
});
