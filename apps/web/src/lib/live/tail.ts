// Cursor logic for the Live feed SSE (S90). `portal_events` is append-only,
// but a row's `at` is set inside its writer's transaction, so a row can commit
// slightly after a later-`at` row was already streamed. Each poll therefore
// re-reads from `highWater - TAIL_OVERLAP_MS` and drops ids it has sent.

export const TAIL_OVERLAP_MS = 5_000;
export const TAIL_POLL_INTERVAL_MS = 2_500;
/** Streams end before typical proxy idle limits; the browser reconnects. */
export const TAIL_LIFETIME_MS = 55_000;
export const TAIL_RECONNECT_MS = 3_000;
/** Rows read per poll; a burst larger than this drains over later polls. */
export const TAIL_PAGE = 100;

export type FeedCursor = { at: Date; id: string };

export type TailState = {
  /** Latest `at` streamed (or the cursor / connection time). */
  highWater: Date;
  /** Rows at or before this key are never sent (the client already has them). */
  baseline: FeedCursor;
  seen: Set<string>;
};

/** Ids sort after every uuid, so a baseline at `now` excludes rows at `now`. */
const AFTER_ALL_IDS = "￿";

export function initialTailState(cursor: FeedCursor | null, now: Date): TailState {
  const baseline = cursor ?? { at: now, id: AFTER_ALL_IDS };
  return { highWater: baseline.at, baseline, seen: new Set() };
}

export function tailPollFrom(state: TailState): Date {
  return new Date(state.highWater.getTime() - TAIL_OVERLAP_MS);
}

export function isAfterCursor(row: FeedCursor, cursor: FeedCursor): boolean {
  const d = row.at.getTime() - cursor.at.getTime();
  return d > 0 || (d === 0 && row.id > cursor.id);
}

/** Rows to send from one poll, oldest first; updates `state`. */
export function takeNewEvents<T extends FeedCursor>(state: TailState, rows: readonly T[]): T[] {
  const out: T[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const row of sorted) {
    if (state.seen.has(row.id)) continue;
    state.seen.add(row.id);
    if (row.at > state.highWater) state.highWater = row.at;
    if (!isAfterCursor(row, state.baseline)) continue;
    out.push(row);
  }
  // Ids older than the overlap window can never be re-read; forget them.
  if (state.seen.size > TAIL_PAGE * 4) {
    const floor = tailPollFrom(state).getTime();
    const keep = new Set(sorted.filter((r) => r.at.getTime() >= floor).map((r) => r.id));
    for (const id of state.seen) if (!keep.has(id)) state.seen.delete(id);
  }
  return out;
}
