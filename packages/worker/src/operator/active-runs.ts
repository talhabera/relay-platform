// Operator sessions with a turn in flight. Process-local, like serial-queue.ts:
// the worker runs as a single replica, so this Set is the whole truth.

const running = new Set<string>();

export function markRunStarted(chatId: string): void {
  running.add(chatId);
}

export function markRunFinished(chatId: string): void {
  running.delete(chatId);
}

export function isRunActive(chatId: string): boolean {
  return running.has(chatId);
}
