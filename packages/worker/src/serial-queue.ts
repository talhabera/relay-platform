/**
 * One in-flight chain per key.
 *
 * INVARIANT: this Map is process-local, so the serialisation it provides holds
 * only while exactly ONE worker process is running. Scaling the worker past a
 * single replica while inbound auto-reply is enabled silently reintroduces
 * interleaved runs over the same subject — duplicate replies to a customer,
 * two public answers under one comment. `docker-compose.yml` runs a single
 * worker with no replicas; keep it that way, or move this queue into the
 * database before scaling out.
 */
const running = new Map<string, Promise<void>>();

/**
 * Queue `run` behind whatever is already running for `key` and return
 * immediately. Never throws and never rejects: the caller is an HTTP handler
 * that has already answered, so a failure has nowhere to go but the log.
 */
export function enqueue(key: string, run: () => Promise<void>): void {
  const previous = running.get(key) ?? Promise.resolve();

  const next = previous
    // Run regardless of whether the previous entry settled or rejected — one
    // `.then(run, run)` link, not `.catch(() => {}).then(run)`, so `run` fires
    // after a single microtask tick past the previous entry's settlement
    // rather than two. `run` ignores its argument either way.
    .then(run, run)
    .catch((cause) => {
      console.error("[Queue] run failed", key, cause);
    })
    .finally(() => {
      // Only if we are still the tail: a later enqueue on this key owns the
      // entry now, and deleting it would let a third run start alongside it.
      if (running.get(key) === next) running.delete(key);
    });

  running.set(key, next);
}

/** How many keys still have a chain in flight. Exists for the leak test. */
export function pendingKeys(): number {
  return running.size;
}
