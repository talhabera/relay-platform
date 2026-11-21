import { and, eq } from "drizzle-orm";
import {
  checkpoints,
  db,
  type AdChangeCommand,
  type AdPlatform,
  type CheckpointPayload,
  type CheckpointStatus,
} from "@relay/db";
import type { AdPlatformAdapter } from "../integrations/ads/adapter";
import { MANUAL_OUTCOME_DETAIL } from "../integrations/ads/manual-adapter";
import {
  AdChangeInProgressError,
  applyAdChange,
  defaultAdapterFor,
  pgAdChangeStore,
  type AdChangeStore,
  type ApplyAdChangeInput,
  type ApplyAdChangeResult,
} from "./apply-ad-change";

/**
 * 08b2 (RELAY-167): body of `POST /internal/ad-change`. Web has already
 * claimed the card `pending -> approved` (or `failed -> approved` on Retry,
 * which bumps `attempt_count`); this runs part a's `applyAdChange` for it as
 * the person who pressed the button and answers synchronously. A repeated
 * call for the same attempt returns the stored result and never applies
 * twice. Error text is Turkish because web shows it on the failed card.
 */

export type AdChangeCard = {
  id: string;
  companyId: string;
  status: CheckpointStatus;
  payload: CheckpointPayload;
  attemptCount: number;
  resolvedByUserId: string | null;
};

export interface AdChangeCardStore {
  load(checkpointId: string): Promise<AdChangeCard | null>;
  /** Guarded by `status = 'approved'`. */
  saveResult(checkpointId: string, result: Record<string, unknown>): Promise<void>;
}

export type AdChangeRouteDeps = {
  cards: AdChangeCardStore;
  apply: (input: ApplyAdChangeInput) => Promise<ApplyAdChangeResult>;
  now: () => Date;
};

export type AdChangeRouteOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export function parseAdChangeBody(body: unknown): { checkpointId: string } | null {
  const id = (body as { checkpointId?: unknown } | null)?.checkpointId;
  return typeof id === "string" && id.length > 0 ? { checkpointId: id } : null;
}

const fail = (status: number, error: string): AdChangeRouteOutcome => ({ ok: false, status, error });

export async function handleAdChangeRequest(
  checkpointId: string,
  deps: AdChangeRouteDeps = defaultAdChangeRouteDeps,
): Promise<AdChangeRouteOutcome> {
  const card = await deps.cards.load(checkpointId);
  if (!card) return fail(404, "Kart bulunamadı");
  const payload = card.payload;
  if (payload.kind !== "ad_change") return fail(422, "Bu kart bir reklam değişikliği değil");
  if (card.status !== "approved") return fail(409, "Kart onaylanmış durumda değil");
  if (!card.resolvedByUserId) return fail(409, "Kartı onaylayan kişi kayıtlı değil");
  const manual = payload.executionMode === "manual";
  if (Date.parse(payload.expiresAt) <= deps.now().getTime()) {
    return fail(
      409,
      manual
        ? "Bu değişikliğin süresi doldu (24 saat), kaydedilmedi. Panelde değiştirdiysen geri al."
        : "Bu değişikliğin süresi doldu (24 saat), uygulanmadı.",
    );
  }

  let result: ApplyAdChangeResult;
  try {
    result = await deps.apply({
      companyId: card.companyId,
      command: payload.command,
      reason: payload.reason,
      actor: { type: "human", userId: card.resolvedByUserId },
      autonomous: false,
      checkpointId: card.id,
      attempt: card.attemptCount,
      mode: "apply",
    });
  } catch (err) {
    if (err instanceof AdChangeInProgressError) {
      return fail(409, "Bu deneme zaten sürüyor ya da yarıda kaldı. Tekrar dene ile yeni bir deneme başlat.");
    }
    throw err;
  }

  if (result.outcome === "rejected") {
    const why =
      result.code === "cap_unset"
        ? "Günlük reklam limiti tanımlı değil, bütçe artışı reddedildi."
        : "Günlük reklam limiti aşılacağı için reddedildi.";
    return fail(
      409,
      manual ? `${why} Reklam panelinde yaptığın değişikliği geri al.` : why,
    );
  }
  if (result.outcome !== "applied") {
    return fail(
      502,
      manual
        ? `Kaydedilemedi: ${result.detail ?? result.code ?? "bilinmeyen hata"}`
        : `Uygulanamadı: ${result.detail ?? result.code ?? "bilinmeyen hata"}`,
    );
  }

  const stored: Record<string, unknown> = {
    outcome: "applied",
    executionMode: payload.executionMode,
    changeId: result.changeId ?? null,
    totalAfterMinor: result.totalAfterMinor,
    beforeValue: result.beforeValue ?? null,
    afterValue: result.afterValue ?? null,
  };
  // The change already happened: a bookkeeping error here must not turn the
  // card `failed`, or its Retry (attempt + 1) would apply the change again.
  try {
    await deps.cards.saveResult(card.id, stored);
  } catch (err) {
    console.error(
      "[Ad change] applied but saving the card result failed",
      card.id,
      err instanceof Error ? err.message : "unknown error",
    );
  }
  return { ok: true, result: stored };
}

function isManualAfter(value: unknown): boolean {
  return (value as { appliedBy?: unknown } | null)?.appliedBy === "manual";
}

/**
 * The executor's store: an applied result row whose after value the manual
 * adapter stamped `appliedBy: "manual"` also gets the manual `outcome_detail`,
 * so a hand-made change is audited like an API one and told apart from it.
 */
export function manualStampingStore(store: AdChangeStore): AdChangeStore {
  return {
    withCapLock: (companyId, fn) => store.withCapLock(companyId, fn),
    findByCheckpoint: (checkpointId, attempt) => store.findByCheckpoint(checkpointId, attempt),
    insert(row) {
      if (row.phase === "result" && row.outcome === "applied" && isManualAfter(row.afterValue)) {
        return store.insert({ ...row, outcomeDetail: MANUAL_OUTCOME_DETAIL });
      }
      return store.insert(row);
    },
  };
}

export type ApplyWithDeps = {
  store: AdChangeStore;
  adapterFor: (
    platform: AdPlatform,
    companyId: string,
    opts: { command: AdChangeCommand },
  ) => AdPlatformAdapter;
  now: () => Date;
};

/** `applyAdChange` with the card's command handed to the adapter lookup. */
export function applyWith(deps: ApplyWithDeps): AdChangeRouteDeps["apply"] {
  const store = manualStampingStore(deps.store);
  return (input) =>
    applyAdChange(input, {
      store,
      adapterFor: (platform) => deps.adapterFor(platform, input.companyId, { command: input.command }),
      now: deps.now,
    });
}

export const pgAdChangeCardStore: AdChangeCardStore = {
  async load(checkpointId) {
    const row = await db.query.checkpoints.findFirst({
      columns: {
        id: true,
        companyId: true,
        status: true,
        payload: true,
        attemptCount: true,
        resolvedByUserId: true,
      },
      where: eq(checkpoints.id, checkpointId),
    });
    return row ?? null;
  },
  async saveResult(checkpointId, result) {
    await db
      .update(checkpoints)
      .set({ executeResult: result })
      .where(and(eq(checkpoints.id, checkpointId), eq(checkpoints.status, "approved")));
  },
};

const defaultAdChangeRouteDeps: AdChangeRouteDeps = {
  cards: pgAdChangeCardStore,
  apply: applyWith({ store: pgAdChangeStore, adapterFor: defaultAdapterFor, now: () => new Date() }),
  now: () => new Date(),
};
