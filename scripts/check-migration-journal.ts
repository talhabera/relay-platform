// Migration journal check for packages/db/drizzle.
//
// Parallel worktrees on the `v2` integration branch each run `pnpm db:generate`,
// so two units can land migrations with the same numeric prefix or a journal
// entry whose `when` is older than one already applied. The drizzle migrator
// only applies entries whose `when` is newer than the last applied one, so an
// out-of-order entry is skipped silently in every environment that already ran
// its predecessor. This check fails fast on those cases.
//
// Run: pnpm --filter @relay/db exec tsx ../../scripts/check-migration-journal.ts [drizzleDir]
// Renumber procedure: docs/dispatch/v2-rollout.md

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type JournalEntry = { idx: number; when: number; tag: string };
export type Journal = { entries: JournalEntry[] };

// Prefixes that were already duplicated on main before this check existed.
// Both migrations are applied in production, so renaming them is not safe.
// Never add to this list; renumber the new migration instead.
export const GRANDFATHERED_DUPLICATE_PREFIXES: readonly string[] = ["0009"];

const PREFIX = /^(\d{4})_/;

export function findJournalProblems(
  journal: Journal,
  sqlFiles: string[],
  grandfathered: readonly string[] = GRANDFATHERED_DUPLICATE_PREFIXES,
): string[] {
  const problems: string[] = [];
  const entries = journal.entries;

  const byPrefix = new Map<string, string[]>();
  for (const e of entries) {
    const m = PREFIX.exec(e.tag);
    if (!m) {
      problems.push(`journal tag "${e.tag}" has no 4-digit prefix`);
      continue;
    }
    byPrefix.set(m[1], [...(byPrefix.get(m[1]) ?? []), e.tag]);
  }
  for (const [prefix, tags] of byPrefix) {
    if (tags.length > 1 && !grandfathered.includes(prefix)) {
      problems.push(`duplicate migration prefix ${prefix}: ${tags.join(", ")}`);
    }
  }

  const seenTags = new Set<string>();
  entries.forEach((e, i) => {
    if (seenTags.has(e.tag)) problems.push(`journal tag "${e.tag}" appears twice`);
    seenTags.add(e.tag);
    if (e.idx !== i) problems.push(`journal entry "${e.tag}" has idx ${e.idx}, expected ${i}`);
    const prev = entries[i - 1];
    if (prev && !(e.when > prev.when)) {
      problems.push(
        `journal entry "${e.tag}" has when ${e.when}, not after "${prev.tag}" (${prev.when}); the migrator would skip it`,
      );
    }
  });

  const sqlTags = new Set(sqlFiles.filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4)));
  for (const tag of seenTags) {
    if (!sqlTags.has(tag)) problems.push(`journal entry "${tag}" has no ${tag}.sql`);
  }
  for (const tag of sqlTags) {
    if (!seenTags.has(tag)) problems.push(`${tag}.sql is not in meta/_journal.json; the migrator would never run it`);
  }

  return problems;
}

export function checkDrizzleDir(dir: string): string[] {
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as Journal;
  return findJournalProblems(journal, readdirSync(dir));
}

// Works under tsx in both CJS and ESM mode, where import.meta.* may be missing.
const entry = process.argv[1] ?? "";
if (basename(entry) === "check-migration-journal.ts") {
  const dir = resolve(process.argv[2] ?? join(dirname(resolve(entry)), "..", "packages", "db", "drizzle"));
  const problems = checkDrizzleDir(dir);
  if (problems.length > 0) {
    console.error(`migration journal check failed (${dir}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Renumber procedure: docs/dispatch/v2-rollout.md");
    process.exit(1);
  }
  console.log(`migration journal check passed (${dir})`);
}
