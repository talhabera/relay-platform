import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireSession } from "@/lib/auth-server";
import { updateWeeklyTarget } from "./actions";
import { setWeeklyTarget, WeeklyTargetError } from "./target";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const WORKFLOW = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const OWNER = "owner-1";

const workflowsFindFirst = vi.fn();
const set = vi.fn();
const where = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (db.query as unknown as Record<string, unknown>).workflows = {
    findFirst: workflowsFindFirst,
    findMany: vi.fn(),
  };
  workflowsFindFirst.mockResolvedValue({
    id: WORKFLOW,
    companyId: COMPANY,
    targetMetricKey: "leads.qualified_delivered",
  });
  vi.mocked(db.query.companies.findFirst).mockResolvedValue({
    id: COMPANY,
    ownerId: OWNER,
  } as never);
  where.mockResolvedValue(undefined);
  set.mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
});

describe("setWeeklyTarget", () => {
  it("lets the owner set the target on the stored workflow's company", async () => {
    await expect(
      setWeeklyTarget(OWNER, { workflowId: WORKFLOW, weeklyTarget: 12 }),
    ).resolves.toEqual({ workflowId: WORKFLOW, companyId: COMPANY, weeklyTarget: 12 });
    expect(set).toHaveBeenCalledWith({ weeklyTarget: 12 });
  });

  it("refuses a member (owner-only, not membership)", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      companyId: COMPANY,
      userId: "member-1",
      role: "member",
    } as never);
    await expect(
      setWeeklyTarget("member-1", { workflowId: WORKFLOW, weeklyTarget: 12 }),
    ).rejects.toThrow(/Unauthorized/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown workflow", async () => {
    workflowsFindFirst.mockResolvedValue(undefined);
    await expect(
      setWeeklyTarget(OWNER, { workflowId: WORKFLOW, weeklyTarget: 12 }),
    ).rejects.toBeInstanceOf(WeeklyTargetError);
  });

  it("refuses a workflow with no target metric", async () => {
    workflowsFindFirst.mockResolvedValue({
      id: WORKFLOW,
      companyId: COMPANY,
      targetMetricKey: null,
    });
    await expect(
      setWeeklyTarget(OWNER, { workflowId: WORKFLOW, weeklyTarget: 12 }),
    ).rejects.toMatchObject({ code: "no_target_metric" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, 10_001])("rejects target %s", async (weeklyTarget) => {
    await expect(
      setWeeklyTarget(OWNER, { workflowId: WORKFLOW, weeklyTarget }),
    ).rejects.toThrow();
    expect(workflowsFindFirst).not.toHaveBeenCalled();
  });
});

describe("updateWeeklyTarget action", () => {
  it("uses the session user", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: OWNER },
    } as never);
    await expect(
      updateWeeklyTarget({ workflowId: WORKFLOW, weeklyTarget: 8 }),
    ).resolves.toMatchObject({ weeklyTarget: 8 });
  });
});
