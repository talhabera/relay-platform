// Inline diff marks for the Mail work pane (05 session-mail/default,
// /ask-for-changes): a step's body diffed against its version before the
// agent's last edit, word by word. Pure and client-safe; the marks are the
// `insert` / `delete` runs `EmailStepCard` renders and tallies.

import type { EmailParagraph, EmailSegment } from "@/components/v2/work/email-step-card";

type Op = { kind: "equal" | "delete" | "insert"; text: string };

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Token-level LCS diff. Paragraphs are short, so O(n*m) is fine. */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "delete", text: a[i]! });
      i++;
    } else {
      ops.push({ kind: "insert", text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "delete", text: a[i++]! });
  while (j < m) ops.push({ kind: "insert", text: b[j++]! });
  return ops;
}

/** A run of the diff: unchanged text, or a changed region (old -> new). */
type Run = { kind: "equal"; text: string } | { kind: "change"; old: string; next: string };

function toRuns(ops: Op[]): Run[] {
  const runs: Run[] = [];
  for (const op of ops) {
    const last = runs.at(-1);
    if (op.kind === "equal") {
      if (last?.kind === "equal") last.text += op.text;
      else runs.push({ kind: "equal", text: op.text });
    } else {
      const change = last?.kind === "change" ? last : { kind: "change" as const, old: "", next: "" };
      if (change !== last) runs.push(change);
      if (op.kind === "delete") change.old += op.text;
      else change.next += op.text;
    }
  }
  return runs;
}

const changeSize = (run: Run) => (run.kind === "change" ? Math.max(run.old.length, run.next.length) : 0);

/**
 * Semantic cleanup: an unchanged run squeezed between two changes and no
 * longer than either of them (a stray "to", a lone space) is folded into one
 * change, so a rewritten sentence reads as one strike and one insert.
 */
function foldShortEqualities(runs: Run[]): Run[] {
  let out = runs;
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 1; k < out.length - 1; k++) {
      const prev = out[k - 1]!;
      const mid = out[k]!;
      const next = out[k + 1]!;
      if (mid.kind !== "equal" || prev.kind !== "change" || next.kind !== "change") continue;
      if (mid.text.length > changeSize(prev) || mid.text.length > changeSize(next)) continue;
      const merged: Run = {
        kind: "change",
        old: prev.old + mid.text + next.old,
        next: prev.next + mid.text + next.next,
      };
      out = [...out.slice(0, k - 1), merged, ...out.slice(k + 2)];
      changed = true;
      break;
    }
  }
  return out;
}

const LEADING_WS = /^\s+/;
const TRAILING_WS = /\s+$/;

function pushPlain(segments: EmailSegment[], text: string) {
  if (!text) return;
  const last = segments.at(-1);
  if (last && !last.change) last.text += text;
  else segments.push({ text });
}

/**
 * Word-level inline diff of one paragraph: unchanged text plain, removed text
 * as a delete run, added text as an insert run. Edge whitespace of a change
 * stays plain so marks hug the words; a replaced phrase renders as
 * "<del> <ins>" with one plain space between.
 */
export function diffWords(before: string, after: string): EmailSegment[] {
  if (before === after) return after ? [{ text: after }] : [];
  const runs = foldShortEqualities(toRuns(lcsOps(tokenize(before), tokenize(after))));
  const segments: EmailSegment[] = [];
  for (const run of runs) {
    if (run.kind === "equal") {
      pushPlain(segments, run.text);
      continue;
    }
    const side = run.next || run.old;
    pushPlain(segments, LEADING_WS.exec(side)?.[0] ?? "");
    const removed = run.old.trim();
    const added = run.next.trim();
    if (removed) segments.push({ text: removed, change: "delete" });
    if (removed && added) pushPlain(segments, " ");
    if (added) segments.push({ text: added, change: "insert" });
    pushPlain(segments, TRAILING_WS.exec(side)?.[0] ?? "");
  }
  return segments;
}

/**
 * Body diff, paragraph by paragraph (paired by position). Without a previous
 * version the body shows unmarked.
 */
export function diffParagraphs(previous: string[] | undefined, current: string[]): EmailParagraph[] {
  if (!previous) return current.map((text) => [{ text }]);
  const length = Math.max(previous.length, current.length);
  const body: EmailParagraph[] = [];
  for (let k = 0; k < length; k++) {
    const before = previous[k];
    const after = current[k];
    if (before === undefined) body.push([{ text: after!, change: "insert" }]);
    else if (after === undefined) body.push([{ text: before, change: "delete" }]);
    else body.push(diffWords(before, after));
  }
  return body;
}
