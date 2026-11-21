import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import path from "node:path";
import {
  insertLeadEvent,
  leadEventActorColumns,
  LeadEventActorError,
  recordFallbackActor,
  transitionLeadStatus,
  type LeadEventActor,
  type LeadEventExecutor,
} from "./lead-events";
import { leadEvents } from "./schema/lead-events";
import { companies } from "./schema/companies";
import { companyRecords } from "./schema/company-records";

type Calls = {
  updates: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
  locked: boolean;
};

/** Minimal drizzle-shaped fake: one record with `status`, or none. */
function fakeExecutor(current: { status: string; allowed?: boolean } | null) {
  const calls: Calls = { updates: [], inserts: [], locked: false };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (mode: string) => {
            calls.locked = mode === "update";
            return Promise.resolve(
              current ? [{ allowed: true, ...current }] : [],
            );
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        calls.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        calls.inserts.push(values);
        return { returning: () => Promise.resolve([{ id: "ev-1", ...values }]) };
      },
    }),
  };
  const executor = {
    ...tx,
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { executor: executor as unknown as LeadEventExecutor, calls };
}

const base = { companyId: "co-1", recordId: "rec-1" };
const at = new Date("2026-10-05T08:00:00Z");

describe("leadEventActorColumns (exactly one actor)", () => {
  it("accepts an agent or a person", () => {
    expect(leadEventActorColumns({ agentId: "a-1" })).toEqual({
      agentId: "a-1",
      userId: null,
    });
    expect(leadEventActorColumns({ userId: "u-1" })).toEqual({
      agentId: null,
      userId: "u-1",
    });
  });

  it.each([
    ["both", { agentId: "a-1", userId: "u-1" }],
    ["neither", {}],
    ["empty agent", { agentId: "" }],
    ["empty user", { userId: "" }],
  ])("refuses %s", (_label, actor) => {
    expect(() => leadEventActorColumns(actor as LeadEventActor)).toThrow(
      LeadEventActorError,
    );
  });
});

describe("lead_events table", () => {
  const config = getTableConfig(leadEvents);

  it("enforces exactly one actor at the database", () => {
    const chk = config.checks.find((c) => c.name === "lead_events_one_actor_chk");
    expect(chk).toBeDefined();
    const sql = readFileSync(
      path.join(__dirname, "../drizzle/0028_lead_events.sql"),
      "utf8",
    );
    expect(sql).toContain(
      `CONSTRAINT "lead_events_one_actor_chk" CHECK (num_nonnulls(agent_id, user_id) = 1)`,
    );
  });

  it("keeps credit when an agent or user is deleted (no actor foreign keys)", () => {
    const fkColumns = config.foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );
    expect(fkColumns.sort()).toEqual(["company_id", "record_id"]);
    for (const fk of config.foreignKeys) {
      expect(fk.onDelete).toBe("cascade");
      expect([companies, companyRecords]).toContain(fk.reference().foreignTable);
    }
  });

  it("indexes the period and per-agent reads", () => {
    const names = config.indexes.map((i) => i.config.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "lead_events_company_id_at_idx",
        "lead_events_record_id_at_idx",
        "lead_events_agent_id_at_idx",
      ]),
    );
  });

  it("gives every company a timezone, UTC until set", () => {
    const tz = getTableConfig(companies).columns.find((c) => c.name === "timezone");
    expect(tz?.notNull).toBe(true);
    expect(tz?.default).toBe("UTC");
  });
});

describe("transitionLeadStatus", () => {
  it("updates the status and logs from -> to with the agent, in one transaction", async () => {
    const { executor, calls } = fakeExecutor({ status: "researched" });
    const result = await transitionLeadStatus(executor, {
      ...base,
      toStatus: "qualified",
      actor: { agentId: "agent-q" },
      at,
      set: { score: 8 },
    });
    expect(executor.transaction).toHaveBeenCalledTimes(1);
    expect(calls.locked).toBe(true);
    expect(calls.updates).toEqual([{ score: 8, status: "qualified", updatedAt: at }]);
    expect(calls.inserts).toEqual([
      {
        companyId: "co-1",
        recordId: "rec-1",
        fromStatus: "researched",
        toStatus: "qualified",
        agentId: "agent-q",
        userId: null,
        at,
      },
    ]);
    expect(result).toMatchObject({ changed: true, event: { id: "ev-1" } });
  });

  it("credits a person's override to the user", async () => {
    const { executor, calls } = fakeExecutor({ status: "replied" });
    await transitionLeadStatus(executor, {
      ...base,
      toStatus: "qualified",
      actor: { userId: "user-1" },
      at,
    });
    expect(calls.inserts[0]).toMatchObject({ agentId: null, userId: "user-1" });
  });

  it("does not let `set` override the status", async () => {
    const { executor, calls } = fakeExecutor({ status: "pending" });
    await transitionLeadStatus(executor, {
      ...base,
      toStatus: "researched",
      actor: { agentId: "a" },
      at,
      set: { status: "failed" } as never,
    });
    expect(calls.updates[0].status).toBe("researched");
  });

  it("writes and logs nothing when the status is unchanged", async () => {
    const { executor, calls } = fakeExecutor({ status: "qualified" });
    const result = await transitionLeadStatus(executor, {
      ...base,
      toStatus: "qualified",
      actor: { agentId: "a" },
    });
    expect(result).toEqual({ changed: false, reason: "same_status" });
    expect(calls.updates).toEqual([]);
    expect(calls.inserts).toEqual([]);
  });

  it("reports a missing record (or another company's) without writing", async () => {
    const { executor, calls } = fakeExecutor(null);
    const result = await transitionLeadStatus(executor, {
      ...base,
      toStatus: "qualified",
      actor: { agentId: "a" },
    });
    expect(result).toEqual({ changed: false, reason: "not_found" });
    expect(calls.inserts).toEqual([]);
  });

  it("writes nothing when the row fails the caller's guard", async () => {
    const { executor, calls } = fakeExecutor({ status: "processing", allowed: false });
    const result = await transitionLeadStatus(executor, {
      ...base,
      toStatus: "processing",
      actor: { agentId: "a" },
      guard: sql`false`,
    });
    // same_status wins only after the guard: an unchanged, unclaimable row
    // reports same_status; a changed one reports guard_failed.
    expect(result.changed).toBe(false);
    expect(calls.inserts).toEqual([]);

    const second = fakeExecutor({ status: "researched", allowed: false });
    await expect(
      transitionLeadStatus(second.executor, {
        ...base,
        toStatus: "processing",
        actor: { agentId: "a" },
        guard: sql`false`,
      }),
    ).resolves.toEqual({ changed: false, reason: "guard_failed" });
    expect(second.calls.updates).toEqual([]);
  });

  it("refuses a bad actor before touching the database", async () => {
    const { executor } = fakeExecutor({ status: "pending" });
    await expect(
      transitionLeadStatus(executor, {
        ...base,
        toStatus: "researched",
        actor: { agentId: "a", userId: "u" } as LeadEventActor,
      }),
    ).rejects.toThrow(LeadEventActorError);
    expect(executor.transaction).not.toHaveBeenCalled();
  });
});

describe("insertLeadEvent", () => {
  it("logs a lead's creation with a null from-status", async () => {
    const { executor, calls } = fakeExecutor(null);
    await insertLeadEvent(executor, {
      ...base,
      fromStatus: null,
      toStatus: "pending",
      actor: { agentId: "agent-g" },
    });
    expect(calls.inserts).toEqual([
      {
        companyId: "co-1",
        recordId: "rec-1",
        fromStatus: null,
        toStatus: "pending",
        agentId: "agent-g",
        userId: null,
      },
    ]);
  });
});

describe("recordFallbackActor", () => {
  function ownerExecutor(rows: { ownerId: string }[]) {
    const select = vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(rows) }),
    }));
    return { executor: { select } as unknown as LeadEventExecutor, select };
  }

  it("credits the agent that sourced the record", async () => {
    const { executor, select } = ownerExecutor([]);
    await expect(
      recordFallbackActor(executor, { companyId: "co-1", sourceAgentId: "a-1" }),
    ).resolves.toEqual({ agentId: "a-1" });
    expect(select).not.toHaveBeenCalled();
  });

  it("falls back to the company owner", async () => {
    const { executor } = ownerExecutor([{ ownerId: "owner-1" }]);
    await expect(
      recordFallbackActor(executor, { companyId: "co-1", sourceAgentId: null }),
    ).resolves.toEqual({ userId: "owner-1" });
  });
});
