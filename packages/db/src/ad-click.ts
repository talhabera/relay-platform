import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export {
  AD_CURRENCY,
  AD_CHANNELS,
  AD_CODE_PREFIX,
  CLICK_TTL_DAYS,
  META_FIXED_CODE_PATTERN,
  isValidAdCode,
} from "./ad-constants";
export type { AdChannel } from "./ad-constants";

/**
 * Rate-limit subject for a visitor IP: `HMAC-SHA256(salt, utcDay + ":" + ip)`
 * truncated to 16 hex chars. The salt-plus-UTC-day input makes the subject
 * short-lived (it changes daily) and unlinkable across days. The IP itself
 * is never stored or logged; the caller drops it after deriving this.
 */
export function ipSubject(salt: string, utcDay: string, ip: string): string {
  return createHmac("sha256", salt)
    .update(`${utcDay}:${ip}`)
    .digest("hex")
    .slice(0, 16);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdClickExecutor = PgDatabase<PgQueryResultHKT, any, any>;

export type BindClickToRecordInput = {
  companyId: string;
  code: string;
  recordId: string;
  now: Date;
};

/** postgres-js returns the rows array itself; pg-style drivers wrap it. */
function rows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const wrapped = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

/**
 * Binds the click carrying `code` to one lead (`company_records` row), in a
 * single conditional UPDATE. A code binds to one lead only and a lead holds
 * at most one linked click: the `NOT EXISTS` guard makes a second, different
 * valid code on an already-bound lead a no-op (`false`) instead of a `23505`
 * unique violation on the partial index. Two concurrent binds of different
 * codes to the same record can still both pass the guard under READ
 * COMMITTED; the unique index then raises `23505`, which the caller (RL4b)
 * swallows in a savepoint. Returns whether a row changed.
 */
export async function bindClickToRecord(
  executor: AdClickExecutor,
  input: BindClickToRecordInput,
): Promise<boolean> {
  const now = input.now.toISOString();
  const result = await executor.execute(sql`
    UPDATE ad_clicks
    SET linked_record_id = ${input.recordId}::uuid,
        linked_at = ${now}::timestamptz
    WHERE company_id = ${input.companyId}::uuid
      AND code = ${input.code}
      AND linked_record_id IS NULL
      AND expires_at > ${now}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM ad_clicks
        WHERE company_id = ${input.companyId}::uuid
          AND linked_record_id = ${input.recordId}::uuid
      )
    RETURNING id
  `);
  return rows(result).length > 0;
}
