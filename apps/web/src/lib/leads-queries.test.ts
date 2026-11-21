import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { collectColumnNames } from "@/test-utils/column-names";
import {
  countAgentLeadsByStatus,
  exportAgentLeads,
  listAgentLeads,
  parseLeadStatus,
  LEAD_LIST_LIMIT,
} from "./leads-queries";

const AGENT = { id: "agent-1", companyId: "company-1" };

const limit = vi.fn();
const orderBy = vi.fn(() => ({ limit }));
const where = vi.fn((_condition: unknown) => ({ orderBy, groupBy: vi.fn() }));
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));

beforeEach(() => {
  vi.clearAllMocks();
  (db as unknown as { select: unknown }).select = select;
  limit.mockResolvedValue([]);
});

describe("listAgentLeads", () => {
  // A mock returns rows whatever the query says; only the built where can
  // show the company and agent boundary is still in it.
  it("filters by company and agent, never by agent alone", async () => {
    await listAgentLeads(AGENT);

    const columns = collectColumnNames(where.mock.calls[0][0]);
    expect(columns).toEqual(expect.arrayContaining(["company_id", "agent_id"]));
  });

  it("adds the status filter only when asked", async () => {
    await listAgentLeads(AGENT);
    await listAgentLeads(AGENT, "qualified");

    expect(collectColumnNames(where.mock.calls[0][0])).not.toContain("status");
    expect(collectColumnNames(where.mock.calls[1][0])).toContain("status");
  });

  it("caps the page", async () => {
    await listAgentLeads(AGENT);
    expect(limit).toHaveBeenCalledWith(LEAD_LIST_LIMIT);
  });
});

describe("exportAgentLeads", () => {
  beforeEach(() => {
    orderBy.mockResolvedValueOnce([] as never);
  });

  it("filters by company and agent, never by agent alone", async () => {
    await exportAgentLeads(AGENT);

    const columns = collectColumnNames(where.mock.calls[0][0]);
    expect(columns).toEqual(expect.arrayContaining(["company_id", "agent_id"]));
  });

  it("adds the status filter only when asked", async () => {
    orderBy.mockResolvedValueOnce([] as never);

    await exportAgentLeads(AGENT);
    await exportAgentLeads(AGENT, "qualified");

    expect(collectColumnNames(where.mock.calls[0][0])).not.toContain("status");
    expect(collectColumnNames(where.mock.calls[1][0])).toContain("status");
  });

  // The page is capped at LEAD_LIST_LIMIT; the export is the billing file and
  // must hold every lead.
  it("is not capped", async () => {
    await exportAgentLeads(AGENT);

    expect(orderBy).toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });
});

describe("countAgentLeadsByStatus", () => {
  it("filters by company and agent and fills missing statuses with zero", async () => {
    const groupBy = vi.fn().mockResolvedValue([{ status: "qualified", count: 3 }]);
    where.mockReturnValueOnce({ orderBy, groupBy });

    const counts = await countAgentLeadsByStatus(AGENT);

    expect(collectColumnNames(where.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["company_id", "agent_id"]),
    );
    expect(counts).toEqual({ new: 0, qualified: 3, rejected: 0 });
  });
});

describe("parseLeadStatus", () => {
  it.each([
    ["qualified", "qualified"],
    ["new", "new"],
    ["rejected", "rejected"],
    ["bogus", undefined],
    [null, undefined],
    ["", undefined],
  ])("%s -> %s", (value, expected) => {
    expect(parseLeadStatus(value as string | null)).toBe(expected);
  });
});
