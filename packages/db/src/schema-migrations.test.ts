import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { agents } from "./schema/agents";
import { chats } from "./schema/chats";
import { companyMembers } from "./schema/company-members";
import { agentVersions } from "./schema/agent-versions";
import { operatorAgentEditors } from "./schema/operator-agent-editors";
import { cronJobs } from "./schema/cron-jobs";
import { cronRuns } from "./schema/cron-runs";
import { cronRunMessages } from "./schema/cron-run-messages";
import { sessionFiles } from "./schema/session-files";
import { companyRecords, SALE_PACKAGES } from "./schema/company-records";
import { checkpoints } from "./schema/checkpoints";
import { instagramComments } from "./schema/instagram-comments";
import { rateLimitCounters, rateLimitLeases } from "./schema/rate-limits";
import { companies } from "./schema/companies";
import { messages } from "./schema/messages";
import { agentHandoffSettings, handoffRequests } from "./schema/handoff";
import { leadEvents } from "./schema/lead-events";
import { portalEvents, PORTAL_EVENT_TYPES } from "./schema/portal-events";
import { companyHomeTiles, HOME_TILE_KEYS } from "./schema/home-tiles";
import { PAGE_PERMISSION_KEYS } from "./schema/company-members";
import {
  agentQuestions,
  AGENT_QUESTION_STATUSES,
} from "./schema/agent-questions";
import { dailyBriefs } from "./schema/daily-briefs";
import { adSpendDaily } from "./schema/ad-spend-daily";
import { adClicks } from "./schema/ad-clicks";
import { adMetaMappings } from "./schema/ad-meta-mappings";
import { adChangeLog } from "./schema/ad-change-log";
import { projects, PROJECT_STATUSES } from "./schema/projects";
import {
  tasks,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_SOURCES,
} from "./schema/tasks";

function allSql(): string {
  const dir = path.join(__dirname, "../drizzle");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .join("\n");
}

describe("SQL migrations vs schema", () => {
  it("creates every agents column the app selects", () => {
    const sql = allSql();
    for (const column of Object.values(getTableColumns(agents))) {
      expect(sql, `migrations omit agents.${column.name}`).toContain(
        `"${column.name}"`,
      );
    }
  });

  it.each([
    ["chats", chats],
    ["company_members", companyMembers],
    ["agent_versions", agentVersions],
    ["operator_agent_editors", operatorAgentEditors],
    ["cron_jobs", cronJobs],
    ["cron_runs", cronRuns],
    ["cron_run_messages", cronRunMessages],
    ["session_files", sessionFiles],
    ["company_records", companyRecords],
    ["checkpoints", checkpoints],
    ["instagram_comments", instagramComments],
    ["companies", companies],
    ["rate_limit_counters", rateLimitCounters],
    ["rate_limit_leases", rateLimitLeases],
    ["lead_events", leadEvents],
    ["daily_briefs", dailyBriefs],
    ["projects", projects],
    ["tasks", tasks],
    ["ad_spend_daily", adSpendDaily],
    ["ad_clicks", adClicks],
    ["ad_meta_mappings", adMetaMappings],
  ] as const)("creates every %s column", (_name, table) => {
    const sql = allSql();
    for (const column of Object.values(getTableColumns(table))) {
      expect(sql, `migrations omit ${column.name}`).toContain(
        `"${column.name}"`,
      );
    }
  });

  it("adds panel chat model, status, master channel, and one-live index", () => {
    const sql = allSql();
    expect(sql).toContain("agent_versions_one_live_idx");
    expect(sql).toContain(`"status" = 'live'`);
    expect(sql).toContain("haiku"); // model keys only, not claude API IDs in SQL
    expect(sql).toMatch(/ADD COLUMN.*"model"/);
  });

  it("adds cron_run_id to session_files", () => {
    const sql = allSql();
    expect(sql).toContain('"cron_run_id"');
    expect(sql).toContain("session_files_parent_chk");
  });

  it("drops named HTTP tables", () => {
    expect(allSql()).toContain('DROP TABLE IF EXISTS "pending_tool_calls"');
    expect(allSql()).toContain('DROP TABLE IF EXISTS "version_http_endpoints"');
  });

  it("adds page_permissions on company_members", () => {
    const sql = allSql();
    expect(sql).toContain("page_permissions");
    expect(sql).toContain('"chat":true');
    expect(sql).toContain('"operator":true');
  });

  it("retires the chat page permission", () => {
    const sql = allSql();
    expect(sql).toContain(`"page_permissions" - 'chat'`);
    expect(sql).toContain(
      `SET DEFAULT '{"operator":true,"agents":false,"messaging":false,"analytics":false}'::jsonb`,
    );
  });

  it("adds package_slug and revenue package tables", () => {
    const sql = allSql();
    expect(sql).toContain('"package_slug"');
    expect(sql).toContain("agents_company_package_slug_uidx");
    expect(sql).toContain("company_records");
    expect(sql).toContain("pending_actions");
    expect(sql).toContain("pending_actions_parent_chk");
    expect(sql).toContain("company_records_score_chk");
  });

  it("adds operator research connector types and unique index", () => {
    const sql = allSql();
    expect(sql).toContain("hunter");
    expect(sql).toContain("snov");
    expect(sql).toContain("google_places");
    expect(sql).toContain("integrations_company_id_operator_type_uidx");
  });

  it("adds the inbound webhook indexes", () => {
    const sql = allSql();
    expect(sql).toContain("messages_platform_message_id_idx");
    expect(sql).toContain("chats_agent_channel_visitor_idx");
    expect(sql).toContain("channels_whatsapp_phone_number_id_idx");
    expect(sql).toContain("channels_instagram_account_id_idx");
  });

  it("makes the redelivery and conversation indexes unique and partial", () => {
    const sql = allSql();

    // Without UNIQUE, `onConflictDoNothing()` on an inbound message has
    // nothing to conflict with: every Meta redelivery stores a second copy
    // and produces a second billed reply.
    // The final predicate is `IS NOT NULL`, not `metadata ? 'key'`: Postgres
    // cannot prove the `?` operator covers the `->>` equality the status
    // lookup runs, so the `?` form left that query scanning the whole table.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_message_id_idx[^;]*WHERE \(metadata->>'platformMessageId'\) IS NOT NULL/,
    );

    // Without UNIQUE, two concurrent deliveries from one sender both insert
    // and the conversation splits in two forever. The channel_type
    // qualification is equally load-bearing: widget chats put the client IP
    // (or the literal 'unknown') in visitor_id, so an unqualified unique index
    // both fails to build and 500s a second widget visitor behind one IP.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS chats_agent_channel_visitor_idx[^;]*WHERE archived_at IS NULL AND channel_type IN \('whatsapp', 'instagram'\)/,
    );
  });

  it("makes an inbound routing key belong to one channel", () => {
    const sql = allSql();

    // The webhook routes resolve a delivery with findFirst on the routing key
    // in channels.config. Without UNIQUE, a company that types another
    // company's Instagram account id — a public number — receives their DMs
    // and comments under its own agent, and findFirst picks between the two
    // rows arbitrarily. The signature check does not help: it authenticates
    // Meta, not the tenant.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS channels_whatsapp_phone_number_uidx[^;]*WHERE type = 'whatsapp'/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS channels_instagram_account_uidx[^;]*WHERE type = 'instagram'/,
    );
  });

  it("adds company_records research queue columns and pending status", () => {
    const sql = allSql();
    expect(sql).toContain("research_attempt_count");
    expect(sql).toContain("research_last_error");
    expect(sql).toContain("research_locked_at");
    expect(sql).toContain(
      'UPDATE "company_records" SET "status" = \'pending\' WHERE "status" = \'new\'',
    );
  });

  // Drizzle's migrator sends each breakpoint-separated chunk as one query;
  // 0012-0018 keep one statement per chunk and 0020 must too.
  it("separates every statement in 0020_leads.sql with a statement-breakpoint", () => {
    const file = readFileSync(
      path.join(__dirname, "../drizzle/0020_leads.sql"),
      "utf8",
    );
    const chunks = file.split("--> statement-breakpoint");
    const statementsPerChunk = chunks.map(
      (chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .filter((part) => part.trim() !== "").length,
    );
    expect(chunks.length).toBe(5);
    expect(statementsPerChunk.every((count) => count === 1)).toBe(true);
  });

  /** handoff_requests columns added after 0021, by 0036. */
  const LATER_HANDOFF_REQUEST_COLUMNS = [
    "notification_message_id",
    "notification_status",
    "notification_status_at",
    "notification_error",
  ];

  describe("0036_handoff_notification_status", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0036_handoff_notification_status.sql");
    const down = read("down/0036_handoff_notification_status.sql");

    it("adds and drops every notification column, nullable", () => {
      for (const name of LATER_HANDOFF_REQUEST_COLUMNS) {
        expect(up).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${name}" [a-z]+;`));
        expect(down).toContain(`DROP COLUMN IF EXISTS "${name}"`);
      }
      expect(up).toContain('"handoff_requests_notification_status_chk"');
      expect(up).toContain('"handoff_requests_notification_message_id_idx"');
      expect(down).toContain('DROP INDEX IF EXISTS "handoff_requests_notification_message_id_idx"');
      expect(down).toContain(
        'DROP CONSTRAINT IF EXISTS "handoff_requests_notification_status_chk"',
      );
    });

    it("is in the journal", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain(
        "0036_handoff_notification_status",
      );
    });
  });

  describe("0021_human_handoff", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0021_human_handoff.sql");
    const down = read("down/0021_human_handoff.sql");

    function statementsPerChunk(file: string): number[] {
      return file.split("--> statement-breakpoint").map(
        (chunk) =>
          chunk
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .split(";")
            .filter((part) => part.trim() !== "").length,
      );
    }

    it.each([
      ["agent_handoff_settings", agentHandoffSettings],
      ["handoff_requests", handoffRequests],
    ] as const)("up creates every %s column", (_name, table) => {
      for (const column of Object.values(getTableColumns(table))) {
        if (LATER_HANDOFF_REQUEST_COLUMNS.includes(column.name)) continue;
        expect(up, `0021 omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up adds the human author columns to messages", () => {
      for (const column of Object.values(getTableColumns(messages))) {
        expect(allSql(), `migrations omit messages.${column.name}`).toContain(
          `"${column.name}"`,
        );
      }
      expect(up).toMatch(/ADD COLUMN IF NOT EXISTS "author" text/);
      expect(up).toContain("messages_human_display_name_chk");
    });

    it("up keeps one open request per conversation at the database", () => {
      expect(up).toMatch(
        /CREATE UNIQUE INDEX[^;]*"handoff_requests_chat_open_uidx"[^;]*\("chat_id"\) WHERE "handoff_requests"\."status" = 'open'/,
      );
      expect(up).toMatch(/CREATE UNIQUE INDEX[^;]*"handoff_requests_token_hash_uidx"/);
    });

    it("is registered in the journal", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0021_human_handoff");
    });

    it("down reverses everything up creates", () => {
      expect(down).toContain('DROP TABLE IF EXISTS "handoff_requests"');
      expect(down).toContain('DROP TABLE IF EXISTS "agent_handoff_settings"');
      expect(down).toContain('DROP COLUMN IF EXISTS "author"');
      expect(down).toContain('DROP COLUMN IF EXISTS "author_display_name"');
      expect(down).toContain(
        'DROP CONSTRAINT IF EXISTS "messages_human_display_name_chk"',
      );
      // The down file lives in drizzle/down/ so neither the migrator nor
      // allSql() runs it. Tables are dropped in reverse creation order.
      expect(down.indexOf('DROP TABLE IF EXISTS "handoff_requests"')).toBeLessThan(
        down.indexOf('DROP TABLE IF EXISTS "agent_handoff_settings"'),
      );
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  it("renames pending_actions to checkpoints and migrates states", () => {
    const sql = allSql();
    expect(sql).toContain('ALTER TABLE "pending_actions" RENAME TO "checkpoints"');
    expect(sql).toContain("to_regclass('public.pending_actions')");
    expect(sql).toContain('RENAME COLUMN "action_type" TO "kind"');
    expect(sql).toContain('ALTER COLUMN "record_id" DROP NOT NULL');
    expect(sql).toContain(
      'UPDATE "checkpoints" SET "status" = \'discarded\' WHERE "status" = \'rejected\'',
    );
    expect(sql).toContain("checkpoints_parent_chk");
    expect(sql).toContain("checkpoints_superseded_by_checkpoints_id_fk");
    expect(sql).toContain(
      'UPDATE "cron_runs" SET "status" = \'awaiting_input\' WHERE "status" = \'awaiting_approval\'',
    );
  });

  it("journals 0022_checkpoints", () => {
    const journal = JSON.parse(
      readFileSync(path.join(__dirname, "../drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(
      journal.entries.find((entry) => entry.tag === "0022_checkpoints"),
    ).toMatchObject({
      idx: 22,
      tag: "0022_checkpoints",
    });
  });

  it("separates every statement in 0022_checkpoints.sql with a statement-breakpoint", () => {
    const file = readFileSync(
      path.join(__dirname, "../drizzle/0022_checkpoints.sql"),
      "utf8",
    );
    // A DO $$ ... $$ block is one statement; drop its body before counting.
    const chunks = file
      .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
      .split("--> statement-breakpoint");
    const statementsPerChunk = chunks.map(
      (chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .filter((part) => part.trim() !== "").length,
    );
    expect(statementsPerChunk.every((count) => count === 1)).toBe(true);
  });

  describe("0024_chat_status", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0024_chat_status.sql");
    const down = read("down/0024_chat_status.sql");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) =>
          chunk
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .split(";")
            .filter((part) => part.trim() !== "").length,
      );

    it("adds every chats column the schema declares", () => {
      const sql = allSql();
      for (const column of Object.values(getTableColumns(chats))) {
        expect(sql, `migrations omit chats.${column.name}`).toContain(
          `"${column.name}"`,
        );
      }
      expect(up).toContain(
        'ADD COLUMN IF NOT EXISTS "status" text DEFAULT \'completed\' NOT NULL',
      );
      expect(up).toContain('"chats_company_id_last_activity_at_idx"');
    });

    it("backfills last activity and needs-you sessions", () => {
      expect(up).toMatch(/UPDATE "chats" c SET "last_activity_at"/);
      expect(up).toMatch(/SET "status" = 'needs_you'/);
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0024_chat_status");
      expect(down).toContain('DROP COLUMN IF EXISTS "status"');
      expect(down).toContain('DROP COLUMN IF EXISTS "last_activity_at"');
      expect(down).toContain('DROP INDEX IF EXISTS "chats_company_id_last_activity_at_idx"');
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });

  describe("0027_agent_users (backfill)", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0027_agent_users.sql");
    const down = read("down/0027_agent_users.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("adds can_edit defaulting true and can_approve backfilled true for existing rows", () => {
      expect(up).toContain(
        'ADD COLUMN IF NOT EXISTS "can_edit" boolean DEFAULT true NOT NULL',
      );
      // Existing editor rows get approve: the column arrives with DEFAULT true...
      expect(up).toContain(
        'ADD COLUMN IF NOT EXISTS "can_approve" boolean DEFAULT true NOT NULL',
      );
      // ...and only afterwards do new rows default to no approve.
      const add = up.indexOf('"can_approve" boolean DEFAULT true');
      const flip = up.indexOf('ALTER COLUMN "can_approve" SET DEFAULT false');
      expect(flip).toBeGreaterThan(add);
    });

    it("gives approve-only rows to members who started an operator session", () => {
      const sql = code(up);
      expect(sql).toMatch(
        /INSERT INTO "operator_agent_editors" \("agent_id", "user_id", "can_edit", "can_approve"\)\s+SELECT DISTINCT c\."agent_id", c\."user_id", false, true/,
      );
      expect(sql).toContain(`c."channel_type" = 'operator'`);
      expect(sql).toContain(`m."role" = 'member'`);
      // Owner and agent creator hold approve implicitly: no row.
      expect(sql).toContain(`c."user_id" <> co."owner_id"`);
      expect(sql).toContain(`c."user_id" <> a."created_by_user_id"`);
      // Members who already have an editor row keep it (edit + approve).
      expect(sql).toContain(`ON CONFLICT ("agent_id", "user_id") DO NOTHING`);
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0027_agent_users");
      expect(down).toContain(`DELETE FROM "operator_agent_editors" WHERE "can_edit" = false`);
      expect(down).toContain('DROP COLUMN IF EXISTS "can_approve"');
      expect(down).toContain('DROP COLUMN IF EXISTS "can_edit"');
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0028_lead_events (backfill)", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0028_lead_events.sql");
    const down = read("down/0028_lead_events.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");

    it("adds companies.timezone defaulting to UTC", () => {
      expect(up).toContain(
        `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'UTC' NOT NULL`,
      );
    });

    it("backfills one creation event per existing lead, idempotently", () => {
      const sql = code(up);
      expect(sql).toMatch(
        /INSERT INTO "lead_events" \("company_id", "record_id", "from_status", "to_status", "agent_id", "user_id", "at"\)\s+SELECT r\."company_id", r\."id", NULL, r\."status", r\."source_agent_id"/,
      );
      // Exactly one actor: the sourcing agent, else the owner.
      expect(sql).toContain(
        `CASE WHEN r."source_agent_id" IS NULL THEN co."owner_id" END`,
      );
      expect(sql).toContain(
        `WHERE NOT EXISTS (SELECT 1 FROM "lead_events" e WHERE e."record_id" = r."id")`,
      );
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0028_lead_events");
      expect(down).toContain('DROP TABLE IF EXISTS "lead_events"');
      expect(down).toContain('ALTER TABLE "companies" DROP COLUMN IF EXISTS "timezone"');
    });
  });
  describe("0029_portal_events", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0029_portal_events.sql");
    const down = read("down/0029_portal_events.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up creates every portal_events column", () => {
      expect(up).toContain('CREATE TABLE IF NOT EXISTS "portal_events"');
      for (const column of Object.values(getTableColumns(portalEvents))) {
        expect(up, `0029 omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up bounds type to the catalog and indexes the company tail", () => {
      for (const type of PORTAL_EVENT_TYPES) {
        expect(up).toContain(`'${type}'`);
      }
      expect(up).toContain("portal_events_type_chk");
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "portal_events_company_id_at_idx" ON "portal_events" \("company_id", "at" DESC\)/,
      );
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0029_portal_events");
      expect(down).toContain('DROP TABLE IF EXISTS "portal_events"');
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0031_agent_questions", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0031_agent_questions.sql");
    const down = read("down/0031_agent_questions.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up creates every agent_questions column", () => {
      expect(up).toContain('CREATE TABLE IF NOT EXISTS "agent_questions"');
      for (const column of Object.values(getTableColumns(agentQuestions))) {
        expect(up, `0031 omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up bounds status, requires one parent and an answer once answered", () => {
      for (const status of AGENT_QUESTION_STATUSES) {
        expect(up).toContain(`'${status}'`);
      }
      expect(up).toContain("agent_questions_parent_chk");
      expect(up).toContain("agent_questions_status_chk");
      expect(up).toContain("agent_questions_answer_chk");
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "agent_questions_open_company_idx" ON "agent_questions" \("company_id"\) WHERE "status" = 'open'/,
      );
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0031_agent_questions");
      expect(down).toContain('DROP TABLE IF EXISTS "agent_questions"');
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0037_company_home_tiles", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0037_company_home_tiles.sql");
    const down = read("down/0037_company_home_tiles.sql");

    it("up creates every company_home_tiles column", () => {
      expect(up).toContain('CREATE TABLE IF NOT EXISTS "company_home_tiles"');
      for (const column of Object.values(getTableColumns(companyHomeTiles))) {
        expect(up, `0037 omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up bounds tile keys and required permissions to the catalogs", () => {
      // 0048 widened the tile_key CHECK for daily_brief, 0050 for my_tasks and
      // 0054 for ad_report; 0037 holds the original five.
      for (const key of HOME_TILE_KEYS.filter(
        (k) => k !== "daily_brief" && k !== "my_tasks" && k !== "ad_report",
      )) {
        expect(up).toContain(`'${key}'`);
      }
      for (const key of PAGE_PERMISSION_KEYS) expect(up).toContain(`'${key}'`);
      expect(up).toContain('PRIMARY KEY ("company_id", "tile_key")');
      expect(up).toContain("ON DELETE cascade");
    });

    it("is journaled and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toContain("0037_company_home_tiles");
      expect(down).toContain('DROP TABLE IF EXISTS "company_home_tiles"');
    });
  });
  describe("0047_daily_briefs", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0047_daily_briefs.sql");
    const down = read("down/0047_daily_briefs.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up creates every daily_briefs column", () => {
      expect(up).toContain('CREATE TABLE IF NOT EXISTS "daily_briefs"');
      for (const column of Object.values(getTableColumns(dailyBriefs))) {
        expect(up, `0047 omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up keeps one brief per company per local day and indexes the company tail", () => {
      expect(up).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "daily_briefs_company_local_date_uidx" ON "daily_briefs" \("company_id", "local_date"\)/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "daily_briefs_company_created_at_idx" ON "daily_briefs" \("company_id", "created_at"\)/,
      );
      // Company delete removes its briefs; a deleted agent or run detaches.
      expect(up).toContain('REFERENCES "companies"("id") ON DELETE cascade');
      expect(up).toContain('REFERENCES "agents"("id") ON DELETE set null');
      expect(up).toContain('REFERENCES "cron_runs"("id") ON DELETE set null');
    });

    it("is journaled at idx 47 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { idx: number; tag: string }[];
      };
      expect(
        journal.entries.find((entry) => entry.tag === "0047_daily_briefs"),
      ).toMatchObject({ idx: 47, tag: "0047_daily_briefs" });
      expect(down).toContain('DROP TABLE IF EXISTS "daily_briefs"');
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0048_home_tile_daily_brief", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0048_home_tile_daily_brief.sql");
    const down = read("down/0048_home_tile_daily_brief.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up bounds tile_key to the Home tile catalog as of 0048", () => {
      expect(up).toContain('DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk"');
      expect(up).toContain('ADD CONSTRAINT "company_home_tiles_tile_key_chk"');
      // 0050 later widened the CHECK again for my_tasks, and 0054 for ad_report.
      for (const key of HOME_TILE_KEYS.filter((k) => k !== "my_tasks" && k !== "ad_report")) {
        expect(code(up)).toContain(`'${key}'`);
      }
      expect(code(up)).not.toContain("'my_tasks'");
      expect(code(up)).not.toContain("'ad_report'");
    });

    it("is journaled at idx 48 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { idx: number; tag: string }[];
      };
      expect(
        journal.entries.find((entry) => entry.tag === "0048_home_tile_daily_brief"),
      ).toMatchObject({ idx: 48, tag: "0048_home_tile_daily_brief" });
      // Down removes daily_brief rows before restoring the 0037 CHECK.
      expect(code(down).indexOf(`DELETE FROM "company_home_tiles"`)).toBeLessThan(
        code(down).indexOf('ADD CONSTRAINT "company_home_tiles_tile_key_chk"'),
      );
      expect(code(down)).not.toContain("'daily_brief')");
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0049_projects_tasks", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0049_projects_tasks.sql");
    const down = read("down/0049_projects_tasks.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );
    const createTable = (table: string) =>
      up
        .split("--> statement-breakpoint")
        .map(code)
        .find((chunk) => chunk.includes(`CREATE TABLE IF NOT EXISTS "${table}"`)) ?? "";
    const checkClause = (sql: string, name: string) =>
      sql.split("\n").find((line) => line.includes(`CONSTRAINT "${name}" CHECK`)) ?? "";

    it("up creates every projects and tasks column", () => {
      const projectsSql = createTable("projects");
      const tasksSql = createTable("tasks");
      expect(projectsSql).not.toBe("");
      expect(tasksSql).not.toBe("");
      for (const column of Object.values(getTableColumns(projects))) {
        expect(projectsSql, `0049 projects omits ${column.name}`).toContain(`"${column.name}"`);
      }
      for (const column of Object.values(getTableColumns(tasks))) {
        expect(tasksSql, `0049 tasks omits ${column.name}`).toContain(`"${column.name}"`);
      }
    });

    it("up bounds every enum column with a named CHECK", () => {
      const projectsSql = createTable("projects");
      const tasksSql = createTable("tasks");
      const cases = [
        [projectsSql, "projects_status_chk", PROJECT_STATUSES],
        [tasksSql, "tasks_status_chk", TASK_STATUSES],
        [tasksSql, "tasks_priority_chk", TASK_PRIORITIES],
        [tasksSql, "tasks_recurrence_chk", TASK_RECURRENCES],
        [tasksSql, "tasks_source_chk", TASK_SOURCES],
      ] as const;
      for (const [sql, name, values] of cases) {
        const clause = checkClause(sql, name);
        expect(clause, `0049 omits ${name}`).not.toBe("");
        for (const value of values) expect(clause).toContain(`'${value}'`);
      }
    });

    it("up wires the foreign keys", () => {
      const projectsSql = createTable("projects");
      const tasksSql = createTable("tasks");
      // Company delete removes its projects and tasks; anything else detaches.
      expect(projectsSql).toContain('"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade');
      expect(tasksSql).toContain('"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade');
      expect(tasksSql).toContain('"project_id" uuid REFERENCES "projects"("id") ON DELETE set null');
      expect(tasksSql).toContain('"assignee_user_id" text REFERENCES "users"("id") ON DELETE set null');
      expect(tasksSql).toContain('"created_by_user_id" text REFERENCES "users"("id") ON DELETE set null');
      expect(tasksSql).toContain('"brief_id" uuid REFERENCES "daily_briefs"("id") ON DELETE set null');
      // tasks references projects, so projects is created first.
      expect(up.indexOf('CREATE TABLE IF NOT EXISTS "projects"')).toBeLessThan(
        up.indexOf('CREATE TABLE IF NOT EXISTS "tasks"'),
      );
    });

    it("up creates the list indexes", () => {
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "projects_company_status_idx" ON "projects" \("company_id", "status"\)/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "tasks_company_status_idx" ON "tasks" \("company_id", "status"\)/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "tasks_company_due_date_idx" ON "tasks" \("company_id", "due_date"\)/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" \("project_id"\)/,
      );
    });

    it("is journaled at idx 49 after 0048 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0049_projects_tasks");
      expect(entry).toMatchObject({
        idx: 49,
        version: "7",
        tag: "0049_projects_tasks",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0048_home_tile_daily_brief");
      expect(entry!.when).toBeGreaterThan(prev!.when);
      // Down drops tasks before the projects it references.
      const dropTasks = code(down).indexOf('DROP TABLE IF EXISTS "tasks"');
      const dropProjects = code(down).indexOf('DROP TABLE IF EXISTS "projects"');
      expect(dropTasks).toBeGreaterThanOrEqual(0);
      expect(dropProjects).toBeGreaterThan(dropTasks);
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0050_home_tile_my_tasks", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0050_home_tile_my_tasks.sql");
    const down = read("down/0050_home_tile_my_tasks.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up bounds tile_key to the Home tile catalog as of 0050", () => {
      expect(up).toContain('DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk"');
      expect(up).toContain('ADD CONSTRAINT "company_home_tiles_tile_key_chk"');
      // 0054 later widened the CHECK again for ad_report.
      for (const key of HOME_TILE_KEYS.filter((k) => k !== "ad_report")) {
        expect(code(up)).toContain(`'${key}'`);
      }
      expect(code(up)).not.toContain("'ad_report'");
    });

    it("is journaled at idx 50 after 0049 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0050_home_tile_my_tasks");
      expect(entry).toMatchObject({
        idx: 50,
        version: "7",
        when: 1791292160000,
        tag: "0050_home_tile_my_tasks",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0049_projects_tasks");
      expect(entry!.when).toBeGreaterThan(prev!.when);
      // Down removes my_tasks rows before restoring the 0048 CHECK (with
      // daily_brief, without my_tasks).
      expect(code(down).indexOf(`DELETE FROM "company_home_tiles"`)).toBeLessThan(
        code(down).indexOf('ADD CONSTRAINT "company_home_tiles_tile_key_chk"'),
      );
      expect(code(down)).toContain(`WHERE "tile_key" = 'my_tasks'`);
      const restored =
        code(down)
          .split('ADD CONSTRAINT "company_home_tiles_tile_key_chk"')[1] ?? "";
      expect(restored).toContain("'daily_brief'");
      expect(restored).not.toContain("'my_tasks'");
      for (const key of HOME_TILE_KEYS.filter((k) => k !== "my_tasks" && k !== "ad_report")) {
        expect(restored).toContain(`'${key}'`);
      }
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0051_sales_statuses", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0051_sales_statuses.sql");
    const down = read("down/0051_sales_statuses.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const comments = (file: string) =>
      file
        .split("\n")
        .filter((line) => line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );
    const checkClause = (sql: string, name: string) =>
      sql.split("\n").find((line) => line.includes(`CONSTRAINT "${name}" CHECK`)) ?? "";

    it("up adds the sale package and the VAT-excluded amount in minor units", () => {
      expect(code(up)).toContain(
        'ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "sale_package" text',
      );
      expect(code(up)).toContain(
        'ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "sale_amount_minor" integer',
      );
    });

    it("up refuses a won row without a package and a positive amount", () => {
      expect(code(up)).toContain('DROP CONSTRAINT IF EXISTS "company_records_won_sale_chk"');
      const clause = checkClause(code(up), "company_records_won_sale_chk");
      expect(clause, "0051 omits company_records_won_sale_chk").not.toBe("");
      expect(clause).toContain("status <> 'won'");
      expect(clause).toContain("sale_package IS NOT NULL");
      expect(clause).toContain("sale_amount_minor > 0");
    });

    it("up bounds sale_package to every SALE_PACKAGES value", () => {
      expect(code(up)).toContain('DROP CONSTRAINT IF EXISTS "company_records_sale_package_chk"');
      const clause = checkClause(code(up), "company_records_sale_package_chk");
      expect(clause, "0051 omits company_records_sale_package_chk").not.toBe("");
      expect(clause).toContain("sale_package IS NULL");
      expect(SALE_PACKAGES.length).toBeGreaterThan(0);
      for (const value of SALE_PACKAGES) expect(clause).toContain(`'${value}'`);
    });

    it("every company_records column is created by 0001..0051, the sale ones by 0051", () => {
      const sql = allSql();
      const columns = Object.values(getTableColumns(companyRecords)).map((c) => c.name);
      expect(columns).toEqual(expect.arrayContaining(["sale_package", "sale_amount_minor"]));
      for (const name of columns) {
        if (name === "sale_package" || name === "sale_amount_minor") {
          expect(code(up), `0051 omits ${name}`).toContain(`"${name}"`);
        } else {
          expect(sql, `migrations omit company_records.${name}`).toContain(`"${name}"`);
        }
      }
    });

    it("is journaled at idx 51 after 0050", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0051_sales_statuses");
      expect(entry).toMatchObject({
        idx: 51,
        version: "7",
        tag: "0051_sales_statuses",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0050_home_tile_my_tasks");
      expect(entry!.when).toBeGreaterThan(prev!.when);
      expect(journal.entries.filter((e) => e.idx === 51)).toHaveLength(1);
    });

    it("down drops both constraints before both columns and keeps sale rows", () => {
      const body = code(down);
      const dropWon = body.indexOf('DROP CONSTRAINT IF EXISTS "company_records_won_sale_chk"');
      const dropPackage = body.indexOf(
        'DROP CONSTRAINT IF EXISTS "company_records_sale_package_chk"',
      );
      const dropPackageColumn = body.indexOf('DROP COLUMN IF EXISTS "sale_package"');
      const dropAmountColumn = body.indexOf('DROP COLUMN IF EXISTS "sale_amount_minor"');
      for (const at of [dropWon, dropPackage, dropPackageColumn, dropAmountColumn]) {
        expect(at).toBeGreaterThanOrEqual(0);
      }
      const lastConstraint = Math.max(dropWon, dropPackage);
      expect(dropPackageColumn).toBeGreaterThan(lastConstraint);
      expect(dropAmountColumn).toBeGreaterThan(lastConstraint);
      // The DB has no status CHECK, so proposal and won rows stay valid text.
      expect(body).not.toMatch(/DELETE FROM/i);
      expect(body).not.toMatch(/UPDATE "?company_records"?/i);
      const header = comments(down);
      expect(header).toMatch(/does not delete/i);
      expect(header).toContain("proposal");
      expect(header).toContain("won");
      expect(header).toContain(
        "UPDATE company_records SET status = 'meeting' WHERE status IN ('proposal','won')",
      );
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0052_ad_data", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0052_ad_data.sql");
    const down = read("down/0052_ad_data.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );
    const createTable = (table: string) =>
      up
        .split("--> statement-breakpoint")
        .map(code)
        .find((chunk) => chunk.includes(`CREATE TABLE IF NOT EXISTS "${table}"`)) ?? "";
    const checkClause = (sql: string, name: string) =>
      sql.split("\n").find((line) => line.includes(`CONSTRAINT "${name}" CHECK`)) ?? "";
    const companyAdColumns = [
      "ad_monthly_target_minor",
      "ad_cpl_stop_minor",
      "ad_daily_cap_minor",
      "ad_capacity_site_monthly",
      "ad_capacity_social_monthly",
    ] as const;

    it("up creates every ad table column", () => {
      const cases = [
        ["ad_spend_daily", adSpendDaily],
        ["ad_clicks", adClicks],
        ["ad_meta_mappings", adMetaMappings],
      ] as const;
      for (const [table, schema] of cases) {
        const sql = createTable(table);
        expect(sql, `0052 omits table ${table}`).not.toBe("");
        for (const column of Object.values(getTableColumns(schema))) {
          expect(sql, `0052 ${table} omits ${column.name}`).toContain(`"${column.name}"`);
        }
      }
    });

    it("up adds the five companies ad columns with non-negative CHECKs", () => {
      const companyColumns = Object.values(getTableColumns(companies)).map((c) => c.name);
      for (const name of companyAdColumns) {
        expect(companyColumns).toContain(name);
        expect(code(up)).toContain(
          `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "${name}"`,
        );
        const clause = code(up)
          .split("\n")
          .find((line) => line.includes(`"${name}"`) && line.includes(">= 0")) ?? "";
        expect(clause, `0052 omits CHECK for ${name}`).not.toBe("");
      }
      expect(code(up)).toContain('"ad_monthly_target_minor" bigint');
      expect(code(up)).toContain('"ad_cpl_stop_minor" bigint');
      expect(code(up)).toContain('"ad_daily_cap_minor" bigint');
      expect(code(up)).toContain('"ad_capacity_site_monthly" integer');
      expect(code(up)).toContain('"ad_capacity_social_monthly" integer');
    });

    it("up bounds enums, money and codes with named CHECKs", () => {
      const spendSql = createTable("ad_spend_daily");
      const clicksSql = createTable("ad_clicks");
      const mappingsSql = createTable("ad_meta_mappings");
      for (const value of ["google", "instagram", "meta"]) {
        expect(checkClause(spendSql, "ad_spend_daily_channel_chk")).toContain(`'${value}'`);
        expect(checkClause(clicksSql, "ad_clicks_channel_chk")).toContain(`'${value}'`);
      }
      for (const value of ["manual", "csv", "api"]) {
        expect(checkClause(spendSql, "ad_spend_daily_source_chk")).toContain(`'${value}'`);
      }
      expect(checkClause(spendSql, "ad_spend_daily_amount_minor_chk")).toContain(
        "amount_minor >= 0",
      );
      expect(checkClause(clicksSql, "ad_clicks_code_chk")).toContain("code ~ '^[A-Z0-9]{5}$'");
      expect(checkClause(mappingsSql, "ad_meta_mappings_code_chk")).toContain(
        "code ~ '^[A-Z0-9]{5}$'",
      );
      expect(checkClause(clicksSql, "ad_clicks_expires_after_created_chk")).toContain(
        "expires_at > created_at",
      );
    });

    it("up wires foreign keys and click-id caps, with no IP or user-agent column", () => {
      for (const table of ["ad_spend_daily", "ad_clicks", "ad_meta_mappings"]) {
        expect(createTable(table)).toContain(
          '"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade',
        );
      }
      const clicksSql = createTable("ad_clicks");
      expect(clicksSql).toContain(
        '"linked_record_id" uuid REFERENCES "company_records"("id") ON DELETE set null',
      );
      for (const name of ["gclid", "gbraid", "wbraid", "fbclid"]) {
        expect(clicksSql).toContain(`"${name}" varchar(200)`);
      }
      expect(clicksSql).not.toMatch(/"ip"|visitor_ip|"user_agent"/);
      const schemaNames = Object.values(getTableColumns(adClicks)).map((c) => c.name);
      expect(schemaNames).not.toContain("ip");
      expect(schemaNames).not.toContain("user_agent");
    });

    it("up creates the unique and lookup indexes", () => {
      expect(up).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "ad_spend_daily_company_date_channel_campaign_uidx" ON "ad_spend_daily" \("company_id", "spend_date", "channel", "campaign_id"\)/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "ad_spend_daily_company_date_idx" ON "ad_spend_daily" \("company_id", "spend_date"\)/,
      );
      expect(up).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_company_code_uidx" ON "ad_clicks" \("company_id", "code"\)/,
      );
      expect(up).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_linked_record_uidx" ON "ad_clicks" \("linked_record_id"\) WHERE linked_record_id IS NOT NULL/,
      );
      expect(up).toMatch(
        /CREATE INDEX IF NOT EXISTS "ad_clicks_expires_at_idx" ON "ad_clicks" \("expires_at"\)/,
      );
      expect(up).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "ad_meta_mappings_company_source_uidx" ON "ad_meta_mappings" \("company_id", "source_id"\)/,
      );
    });

    it("is journaled at idx 52 after 0051 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0052_ad_data");
      expect(entry).toMatchObject({
        idx: 52,
        version: "7",
        tag: "0052_ad_data",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0051_sales_statuses");
      expect(entry!.when).toBeGreaterThan(prev!.when);
      expect(journal.entries.filter((e) => e.idx === 52)).toHaveLength(1);
      // Down drops the three tables (mappings, clicks, spend) and the columns.
      const body = code(down);
      const drops = ["ad_meta_mappings", "ad_clicks", "ad_spend_daily"].map((t) =>
        body.indexOf(`DROP TABLE IF EXISTS "${t}"`),
      );
      for (const at of drops) expect(at).toBeGreaterThanOrEqual(0);
      expect(drops[0]).toBeLessThan(drops[1]!);
      expect(drops[1]).toBeLessThan(drops[2]!);
      for (const name of companyAdColumns) {
        expect(body).toContain(`DROP COLUMN IF EXISTS "${name}"`);
      }
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
  describe("0053_lead_event_metadata", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0053_lead_event_metadata.sql");
    const down = read("down/0053_lead_event_metadata.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("adds a nullable metadata jsonb column to lead_events, idempotently", () => {
      expect(code(up)).toMatch(
        /ALTER TABLE "lead_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb;/,
      );
      expect(code(up)).not.toMatch(/NOT NULL|DEFAULT/);
      const column = getTableColumns(leadEvents).metadata;
      expect(column.name).toBe("metadata");
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    });

    it("is journaled at idx 53 after 0052 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0053_lead_event_metadata");
      expect(entry).toMatchObject({
        idx: 53,
        version: "7",
        tag: "0053_lead_event_metadata",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0052_ad_data");
      expect(prev!.idx).toBe(52);
      expect(entry!.when).toBeGreaterThan(prev!.when);
      expect(journal.entries.filter((e) => e.idx === 53)).toHaveLength(1);
      expect(code(down)).toMatch(
        /ALTER TABLE "lead_events" DROP COLUMN IF EXISTS "metadata";/,
      );
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });

  describe("0054_home_tile_ad_report", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0054_home_tile_ad_report.sql");
    const down = read("down/0054_home_tile_ad_report.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map(
        (chunk) => code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );

    it("up bounds tile_key to the whole Home tile catalog", () => {
      expect(HOME_TILE_KEYS).toContain("ad_report");
      expect(up).toContain('DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk"');
      expect(up).toContain('ADD CONSTRAINT "company_home_tiles_tile_key_chk"');
      for (const key of HOME_TILE_KEYS) expect(code(up)).toContain(`'${key}'`);
    });

    it("is journaled at idx 54 after 0053 and reversible", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0054_home_tile_ad_report");
      expect(entry).toMatchObject({
        idx: 54,
        version: "7",
        tag: "0054_home_tile_ad_report",
        breakpoints: true,
      });
      const prev = journal.entries.find((e) => e.tag === "0053_lead_event_metadata");
      expect(prev!.idx).toBe(53);
      expect(entry!.when).toBeGreaterThan(prev!.when);
      expect(journal.entries.filter((e) => e.idx === 54)).toHaveLength(1);
      // Down removes ad_report rows before restoring the 0050 CHECK (with
      // my_tasks, without ad_report).
      expect(code(down).indexOf(`DELETE FROM "company_home_tiles"`)).toBeLessThan(
        code(down).indexOf('ADD CONSTRAINT "company_home_tiles_tile_key_chk"'),
      );
      expect(code(down)).toContain(`WHERE "tile_key" = 'ad_report'`);
      const restored =
        code(down)
          .split('ADD CONSTRAINT "company_home_tiles_tile_key_chk"')[1] ?? "";
      expect(restored).toContain("'my_tasks'");
      expect(restored).not.toContain("'ad_report'");
      for (const key of HOME_TILE_KEYS.filter((k) => k !== "ad_report")) {
        expect(restored).toContain(`'${key}'`);
      }
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });

  describe("0055_ad_change_log", () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, "../drizzle", rel), "utf8");
    const up = read("0055_ad_change_log.sql");
    const down = read("down/0055_ad_change_log.sql");
    const code = (file: string) =>
      file
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    // A plpgsql body holds its own semicolons; count it as one statement.
    const statementsPerChunk = (file: string) =>
      file.split("--> statement-breakpoint").map((chunk) =>
        chunk.includes("$$")
          ? 1
          : code(chunk).split(";").filter((part) => part.trim() !== "").length,
      );
    const columns = Object.values(getTableColumns(adChangeLog)).map((c) => c.name);

    it("up creates ad_change_log with every schema column and both CHECKs", () => {
      expect(up).toContain('CREATE TABLE IF NOT EXISTS "ad_change_log"');
      for (const name of columns) expect(code(up)).toContain(`"${name}"`);
      expect(columns).toEqual(
        expect.arrayContaining([
          "seq", "change_id", "phase", "delta_minor", "daily_total_after_minor",
          "checkpoint_id", "attempt", "reverses_change_id", "reason_metric",
          "reason_value", "reason_threshold", "outcome", "outcome_code", "outcome_detail",
        ]),
      );
      expect(code(up)).toContain('"seq" bigint GENERATED ALWAYS AS IDENTITY');
      expect(code(up)).toContain('REFERENCES "companies"("id") ON DELETE restrict');
      expect(code(up)).toContain(`"ad_change_log_outcome_chk" CHECK ((phase = 'intent') = (outcome IS NULL))`);
      expect(code(up)).toContain(
        `"ad_change_log_reason_chk" CHECK (actor_type <> 'agent' OR (reason_metric IS NOT NULL AND reason_value IS NOT NULL AND reason_threshold IS NOT NULL))`,
      );
      expect(code(up)).toContain('"ad_change_log_actor_chk"');
      expect(code(up)).not.toMatch(/'delete|delete_campaign|remove_campaign/i);
    });

    it("up adds the unique and scan indexes", () => {
      expect(code(up)).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "ad_change_log_change_phase_uidx" ON "ad_change_log" ("change_id", "phase")',
      );
      expect(code(up)).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "ad_change_log_checkpoint_attempt_phase_uidx" ON "ad_change_log" ("checkpoint_id", "attempt", "phase") WHERE checkpoint_id IS NOT NULL',
      );
      expect(code(up)).toContain('"ad_change_log_company_seq_idx" ON "ad_change_log" ("company_id", "seq")');
      expect(code(up)).toContain(
        `"ad_change_log_company_intent_created_idx" ON "ad_change_log" ("company_id", "created_at") WHERE phase = 'intent'`,
      );
    });

    it("up makes the table append-only with a raising function and three triggers", () => {
      expect(code(up)).toContain('CREATE OR REPLACE FUNCTION "ad_change_log_immutable"() RETURNS trigger');
      expect(code(up)).toContain("RAISE EXCEPTION 'ad_change_log is append-only'");
      expect(code(up)).toContain(
        'CREATE TRIGGER "ad_change_log_no_update_trg" BEFORE UPDATE ON "ad_change_log" FOR EACH ROW EXECUTE FUNCTION "ad_change_log_immutable"()',
      );
      expect(code(up)).toContain(
        'CREATE TRIGGER "ad_change_log_no_delete_trg" BEFORE DELETE ON "ad_change_log" FOR EACH ROW EXECUTE FUNCTION "ad_change_log_immutable"()',
      );
      expect(code(up)).toContain(
        'CREATE TRIGGER "ad_change_log_no_truncate_trg" BEFORE TRUNCATE ON "ad_change_log" FOR EACH STATEMENT EXECUTE FUNCTION "ad_change_log_immutable"()',
      );
      expect(code(up)).not.toMatch(/ALTER TABLE "(checkpoints|companies)"/);
    });

    it("down drops the triggers, then the function, then the table", () => {
      const d = code(down);
      for (const trg of ["no_update", "no_delete", "no_truncate"]) {
        expect(d).toContain(`DROP TRIGGER IF EXISTS "ad_change_log_${trg}_trg" ON "ad_change_log"`);
        expect(d.indexOf(`"ad_change_log_${trg}_trg"`)).toBeLessThan(
          d.indexOf('DROP FUNCTION IF EXISTS "ad_change_log_immutable"()'),
        );
      }
      expect(d.indexOf('DROP FUNCTION IF EXISTS "ad_change_log_immutable"()')).toBeLessThan(
        d.indexOf('DROP TABLE IF EXISTS "ad_change_log"'),
      );
      expect(down).toContain("apply by hand");
    });

    it("is journaled at idx 55 after 0054", () => {
      const journal = JSON.parse(read("meta/_journal.json")) as {
        entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0055_ad_change_log");
      expect(entry).toMatchObject({ idx: 55, version: "7", tag: "0055_ad_change_log", breakpoints: true });
      const prev = journal.entries.find((e) => e.tag === "0054_home_tile_ad_report");
      expect(prev!.idx).toBe(54);
      expect(entry!.when).toBeGreaterThan(prev!.when);
      expect(journal.entries.filter((e) => e.idx === 55)).toHaveLength(1);
      for (const tag of ["0052_ad_data", "0053_lead_event_metadata"]) {
        expect(journal.entries.some((e) => e.tag === tag)).toBe(true);
      }
    });

    it("separates every statement with a statement-breakpoint", () => {
      expect(statementsPerChunk(up).every((n) => n === 1)).toBe(true);
      expect(statementsPerChunk(down).every((n) => n === 1)).toBe(true);
    });
  });
});
