import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// S26 migration 0032: score x10, `qualified` -> `interested`, `leads` copied
// into company_records. The text checks always run. The database checks run
// only when RELAY_MIGRATION_TEST_DB_URL points at an empty, throwaway Postgres
// (they apply every migration to it and leave the tables behind); never point
// it at a shared database. One-off: `docker run --rm -e POSTGRES_PASSWORD=x
// -p 55432:5432 postgres:16-alpine`, then RELAY_MIGRATION_TEST_DB_URL=
// postgres://postgres:x@127.0.0.1:55432/postgres.

const DRIZZLE = path.join(__dirname, "../drizzle");
const MIGRATION = "0032_lead_scoring.sql";

function migrationSql(file: string): string {
  return readFileSync(path.join(DRIZZLE, file), "utf8");
}

function statements(file: string): string[] {
  return migrationSql(file)
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("0032_lead_scoring.sql (text)", () => {
  const sql = migrationSql(MIGRATION);

  it("multiplies scores and widens the check once, keyed on the old check", () => {
    expect(sql).toContain(`"score" = "score" * 10`);
    expect(sql).toContain("score <= 100");
    expect(sql).toContain("LIKE '%<= 10)%'");
  });

  it("renames post-reply qualified to interested in records and events", () => {
    expect(sql).toContain(
      `UPDATE "company_records" SET "status" = 'interested' WHERE "status" = 'qualified'`,
    );
    expect(sql).toContain(`SET "to_status" = 'interested'`);
    expect(sql).toContain(`SET "from_status" = 'interested'`);
  });

  it("copies qualified leads as qualified, with no fit score", () => {
    expect(sql).toMatch(/WHEN 'qualified' THEN 'qualified'/);
    expect(sql).toContain(`'skor', l."skor" * 10`);
    expect(sql).toContain(`FROM "leads" l`);
  });

  it("renames before it copies, so copied leads are never renamed", () => {
    expect(sql.indexOf(`SET "status" = 'interested'`)).toBeLessThan(
      sql.indexOf(`FROM "leads" l`),
    );
  });

  it("has a down file", () => {
    expect(readdirSync(path.join(DRIZZLE, "down"))).toContain(MIGRATION);
  });
});

const url = process.env.RELAY_MIGRATION_TEST_DB_URL;

describe.skipIf(!url)("0032_lead_scoring.sql (database)", () => {
  const client = postgres(url ?? "postgres://unused", {
    max: 1,
    onnotice: () => undefined,
  });

  const files = (
    JSON.parse(
      readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] }
  ).entries.map((e) => `${e.tag}.sql`);
  const before = files.slice(0, files.indexOf(MIGRATION));

  async function run(file: string) {
    for (const statement of statements(file)) {
      await client.unsafe(statement);
    }
  }

  async function qualifiedCounts() {
    const [row] = await client.unsafe<{ before: number; after: number }[]>(`
      SELECT
        (SELECT count(*)::int FROM leads WHERE status = 'qualified') AS before,
        (SELECT count(*)::int FROM company_records r JOIN leads l ON l.id = r.id
          WHERE r.status = 'qualified') AS after
    `);
    return row;
  }

  beforeAll(async () => {
    for (const file of before) {
      await run(file);
    }
    await client.unsafe(`
      INSERT INTO users (id, name, email) VALUES ('owner-1', 'Owner', 'o@example.com');
      INSERT INTO companies (id, name, owner_id)
        VALUES ('00000000-0000-0000-0000-0000000000c1', 'Acme', 'owner-1');
      -- A Revenue account that replied and was marked qualified (old meaning).
      INSERT INTO company_records (id, company_id, entity_type, name, domain, score, status)
        VALUES ('00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000c1', 'account', 'Acme', 'acme.com', 8, 'qualified');
      INSERT INTO lead_events (company_id, record_id, from_status, to_status, user_id)
        VALUES ('00000000-0000-0000-0000-0000000000c1',
                '00000000-0000-0000-0000-0000000000a1', 'replied', 'qualified', 'owner-1');
      -- #18 leads: billed qualified rows with low, high and no skor.
      INSERT INTO leads (id, company_id, channel_type, tip, m2, lokasyon, butce, iletisim, skor, kod, status) VALUES
        ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'whatsapp', 'daire', '120', 'Kadikoy', '5M', 'Ayse', 3, 'K1', 'qualified'),
        ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 'instagram', 'villa', NULL, NULL, NULL, NULL, NULL, NULL, 'qualified'),
        ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', 'widget', NULL, NULL, NULL, NULL, NULL, 9, NULL, 'new'),
        ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c1', 'telegram', NULL, NULL, NULL, NULL, NULL, 10, NULL, 'rejected'),
        ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c1', 'messenger', 'ofis', '80', 'Sisli', '2M', '+90555', 10, 'K2', 'qualified');
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it("keeps every qualified lead qualified (count before == after)", async () => {
    const counts = await qualifiedCounts();
    expect(counts).toEqual({ before: 3, after: 0 });
    await run(MIGRATION);
    expect(await qualifiedCounts()).toEqual({ before: 3, after: 3 });
  });

  it("maps the other lead statuses and keeps the fit score null", async () => {
    const rows = await client.unsafe<
      { id: string; status: string; score: number | null; source: string; entity_type: string }[]
    >(`SELECT r.id, r.status, r.score, r.source, r.entity_type
       FROM company_records r JOIN leads l ON l.id = r.id ORDER BY r.id`);
    expect(rows.map((r) => [r.status, r.score, r.source, r.entity_type])).toEqual([
      ["qualified", null, "whatsapp", "person"],
      ["qualified", null, "instagram", "person"],
      ["gathered", null, "widget", "person"],
      ["rejected", null, "telegram", "person"],
      ["qualified", null, "messenger", "person"],
    ]);
  });

  it("puts the 5 fields, kod and skor x10 into the intake payload", async () => {
    const [row] = await client.unsafe<
      { payload: { intake: Record<string, unknown> }; intake_complete: boolean; name: string }[]
    >(`SELECT payload, intake_complete, name FROM company_records
       WHERE id = '00000000-0000-0000-0000-0000000000b1'`);
    expect(row.payload.intake).toEqual({
      tip: "daire",
      m2: "120",
      lokasyon: "Kadikoy",
      butce: "5M",
      iletisim: "Ayse",
      kod: "K1",
      skor: 30,
    });
    expect(row.intake_complete).toBe(true);
    expect(row.name).toBe("Ayse");
  });

  it("logs one creation event per copied lead, credited to the owner", async () => {
    const events = await client.unsafe<
      { to_status: string; from_status: string | null; user_id: string | null }[]
    >(`SELECT e.to_status, e.from_status, e.user_id FROM lead_events e
       JOIN leads l ON l.id = e.record_id ORDER BY e.record_id`);
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.from_status === null && e.user_id === "owner-1")).toBe(true);
    expect(events.filter((e) => e.to_status === "qualified")).toHaveLength(3);
  });

  it("scales Revenue scores x10 and renames post-reply qualified to interested", async () => {
    const [record] = await client.unsafe<{ score: number; status: string }[]>(
      `SELECT score, status FROM company_records WHERE id = '00000000-0000-0000-0000-0000000000a1'`,
    );
    expect(record).toEqual({ score: 80, status: "interested" });
    const [event] = await client.unsafe<{ to_status: string }[]>(
      `SELECT to_status FROM lead_events WHERE record_id = '00000000-0000-0000-0000-0000000000a1'`,
    );
    expect(event.to_status).toBe("interested");
  });

  it("is a no-op when run again", async () => {
    await run(MIGRATION);
    const [record] = await client.unsafe<{ score: number }[]>(
      `SELECT score FROM company_records WHERE id = '00000000-0000-0000-0000-0000000000a1'`,
    );
    expect(record.score).toBe(80);
    expect(await qualifiedCounts()).toEqual({ before: 3, after: 3 });
    const [{ n }] = await client.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM lead_events`,
    );
    expect(n).toBe(6);
  });

  it("enforces the new bounds and dedupe keys", async () => {
    await expect(
      client.unsafe(`UPDATE company_records SET score = 101 WHERE id = '00000000-0000-0000-0000-0000000000a1'`),
    ).rejects.toThrow(/company_records_score_chk/);
    await client.unsafe(`UPDATE company_records SET phone = '+905551112233' WHERE id = '00000000-0000-0000-0000-0000000000b1'`);
    await expect(
      client.unsafe(`UPDATE company_records SET phone = '+905551112233' WHERE id = '00000000-0000-0000-0000-0000000000b2'`),
    ).rejects.toThrow(/company_records_company_phone_uidx/);
  });
});
