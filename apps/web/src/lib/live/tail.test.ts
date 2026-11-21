import { describe, expect, it } from "vitest";
import {
  TAIL_OVERLAP_MS,
  initialTailState,
  isAfterCursor,
  tailPollFrom,
  takeNewEvents,
} from "./tail";

const t = (s: number) => new Date(Date.UTC(2026, 9, 3, 10, 0, s));
const row = (id: string, s: number) => ({ id, at: t(s) });

describe("Live feed tail", () => {
  it("without a cursor, sends only rows after opening", () => {
    const state = initialTailState(null, t(10));
    expect(takeNewEvents(state, [row("a", 8), row("b", 10), row("c", 12)]).map((r) => r.id)).toEqual(["c"]);
  });

  it("resumes after a cursor, ordering by (at, id)", () => {
    const state = initialTailState({ at: t(5), id: "m" }, t(30));
    const sent = takeNewEvents(state, [row("z", 6), row("a", 5), row("n", 5), row("b", 4)]);
    expect(sent.map((r) => r.id)).toEqual(["n", "z"]);
  });

  it("never sends a row twice across overlapping polls", () => {
    const state = initialTailState({ at: t(0), id: "0" }, t(0));
    expect(takeNewEvents(state, [row("a", 1), row("b", 2)])).toHaveLength(2);
    expect(tailPollFrom(state).getTime()).toBe(t(2).getTime() - TAIL_OVERLAP_MS);
    // A late commit with an earlier `at` still arrives once.
    const sent = takeNewEvents(state, [row("a", 1), row("late", 1), row("b", 2), row("c", 3)]);
    expect(sent.map((r) => r.id)).toEqual(["late", "c"]);
  });

  it("compares cursors by time then id", () => {
    expect(isAfterCursor(row("b", 1), row("a", 1))).toBe(true);
    expect(isAfterCursor(row("a", 1), row("a", 1))).toBe(false);
    expect(isAfterCursor(row("z", 0), row("a", 1))).toBe(false);
  });
});
