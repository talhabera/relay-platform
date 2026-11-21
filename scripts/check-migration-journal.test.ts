import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrizzleDir, findJournalProblems, type Journal } from "./check-migration-journal";

function journal(...tags: [string, number][]): Journal {
  return { entries: tags.map(([tag, when], idx) => ({ idx, when, tag })) };
}
const sql = (j: Journal) => j.entries.map((e) => `${e.tag}.sql`);

describe("migration journal check", () => {
  it("passes a clean journal", () => {
    const j = journal(["0000_a", 1], ["0001_b", 2]);
    expect(findJournalProblems(j, sql(j))).toEqual([]);
  });

  it("fails on a duplicate migration prefix", () => {
    const j = journal(["0021_lead_events", 1], ["0021_portal_events", 2]);
    expect(findJournalProblems(j, sql(j))).toEqual([
      "duplicate migration prefix 0021: 0021_lead_events, 0021_portal_events",
    ]);
  });

  it("allows only the grandfathered prefixes", () => {
    const j = journal(["0009_page_permissions", 1], ["0009_chat_archived_at", 2]);
    expect(findJournalProblems(j, sql(j))).toEqual([]);
    expect(findJournalProblems(j, sql(j), [])).toHaveLength(1);
  });

  it("fails when when does not increase (migrator would skip it)", () => {
    const j = journal(["0021_a", 5], ["0022_b", 5]);
    expect(findJournalProblems(j, sql(j))[0]).toMatch(/0022_b.*not after "0021_a"/);
  });

  it("fails on idx gaps and repeated tags", () => {
    const j: Journal = {
      entries: [
        { idx: 0, when: 1, tag: "0000_a" },
        { idx: 2, when: 2, tag: "0000_a" },
      ],
    };
    const problems = findJournalProblems(j, ["0000_a.sql"]);
    expect(problems).toContain('journal tag "0000_a" appears twice');
    expect(problems).toContain('journal entry "0000_a" has idx 2, expected 1');
  });

  it("fails on a custom .sql missing from the journal and a journal entry missing its .sql", () => {
    const j = journal(["0000_a", 1], ["0001_b", 2]);
    const problems = findJournalProblems(j, ["0000_a.sql", "0002_custom.sql", "meta"]);
    expect(problems).toContain('journal entry "0001_b" has no 0001_b.sql');
    expect(problems).toContain("0002_custom.sql is not in meta/_journal.json; the migrator would never run it");
  });

  it("passes on the repo's drizzle folder", () => {
    expect(checkDrizzleDir(join(__dirname, "..", "packages", "db", "drizzle"))).toEqual([]);
  });
});
