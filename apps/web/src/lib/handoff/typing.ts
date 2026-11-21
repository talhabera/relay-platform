/**
 * Typing presence for a handoff conversation: the person on the quick link
 * (takeover) and the customer. Presence is short-lived and lossy, so it lives
 * in this process, not the database. With more than one web replica, a reader
 * only sees typing posted to its own replica; move this to Postgres
 * LISTEN/NOTIFY (or Redis) before scaling web out.
 */

export const TYPING_TTL_MS = 6_000;

export type TypingParty = "person" | "customer";

const typingUntil = new Map<string, number>();

function key(chatId: string, party: TypingParty): string {
  return `${chatId}:${party}`;
}

function sweep(now: number): void {
  for (const [k, until] of typingUntil) {
    if (until <= now) typingUntil.delete(k);
  }
}

/** `party` is typing in `chatId` now; it stops counting after the TTL. */
export function markTyping(chatId: string, party: TypingParty, now: number = Date.now()): void {
  sweep(now);
  typingUntil.set(key(chatId, party), now + TYPING_TTL_MS);
}

/** `party` sent its message (or left): stop showing it as typing. */
export function clearTyping(chatId: string, party: TypingParty): void {
  typingUntil.delete(key(chatId, party));
}

export function isTyping(chatId: string, party: TypingParty, now: number = Date.now()): boolean {
  const until = typingUntil.get(key(chatId, party));
  return until !== undefined && until > now;
}
