import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_TOGGLES } from "@relay/db";

const { proposeOutreach } = vi.hoisted(() => ({
  proposeOutreach: vi.fn(),
}));

vi.mock("./propose-action", () => ({
  proposeOutreach,
}));

vi.mock("./company-records", () => ({
  searchCompanyRecords: vi.fn(),
  getCompanyRecord: vi.fn(),
  upsertCompanyRecord: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        sessionFiles: { findFirst: vi.fn() },
      },
      insert: vi.fn(),
    },
  };
});

import { selectOperatorTools } from "./tools";
import { selectCronOperatorTools } from "./cron-tools";

const revenueToggles = {
  webSearch: false,
  excel: false,
  companyMemory: true,
  proposeAction: true,
};

const baseArgs = {
  agentId: "660e8400-e29b-41d4-a716-446655440001",
  companyId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("selectOperatorTools", () => {
  it("registers memory and proposeAction when toggles are on", () => {
    const tools = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      version: { toolToggles: revenueToggles },
    });

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "searchCompanyRecords",
        "getCompanyRecord",
        "upsertCompanyRecord",
        "proposeAction",
      ]),
    );
  });

  it("omits memory and proposeAction when toggles are default false", () => {
    const tools = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });

    expect(Object.keys(tools)).not.toContain("searchCompanyRecords");
    expect(Object.keys(tools)).not.toContain("getCompanyRecord");
    expect(Object.keys(tools)).not.toContain("upsertCompanyRecord");
    expect(Object.keys(tools)).not.toContain("proposeAction");
  });

  it("always registers research tools when all toggles are false", () => {
    const tools = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });

    expect(tools.researchAccount).toBeDefined();
    expect(tools.googlePlaces_searchCompany).toBeDefined();
    expect(tools.hunter_findEmails).toBeDefined();
    expect(tools.snov_findEmails).toBeDefined();
  });

  it("offers no Daily Manager tools without the manager package and session user", () => {
    const tools = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      version: {
        toolToggles: { webSearch: true, excel: true, companyMemory: true, proposeAction: true },
      },
    });

    expect(tools.readWorkspaceState).toBeUndefined();
    expect(tools.postDailyBrief).toBeUndefined();
    expect(tools.listTasks).toBeUndefined();
    expect(tools.createTask).toBeUndefined();
    expect(tools.updateTask).toBeUndefined();
    expect(tools.completeTask).toBeUndefined();
  });

  it("adds the Daily Manager session tools for the manager package, but never postDailyBrief", () => {
    const tools = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      packageSlug: "manager",
      userId: "user-1",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "readWorkspaceState",
        "listTasks",
        "createTask",
        "updateTask",
        "completeTask",
      ]),
    );
    expect(tools.postDailyBrief).toBeUndefined();
    expect(tools.reopenTask).toBeUndefined();
    expect(tools.deleteTask).toBeUndefined();
  });

  it("gives any other slug, or a missing user, exactly today's tool set", () => {
    const today = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });
    const otherSlug = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      packageSlug: "insights",
      userId: "user-1",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });
    const noUser = selectOperatorTools({
      ...baseArgs,
      chatId: "chat-1",
      packageSlug: "manager",
      version: { toolToggles: DEFAULT_TOOL_TOGGLES },
    });

    expect(Object.keys(otherSlug).sort()).toEqual(Object.keys(today).sort());
    expect(Object.keys(noUser).sort()).toEqual(Object.keys(today).sort());
  });
});

describe("company record status schemas", () => {
  type Parseable = { safeParse: (value: unknown) => { success: boolean } };
  const tools = selectOperatorTools({
    ...baseArgs,
    chatId: "chat-1",
    version: { toolToggles: revenueToggles },
  });
  const searchSchema = tools.searchCompanyRecords!.inputSchema as unknown as Parseable;
  const upsertSchema = tools.upsertCompanyRecord!.inputSchema as unknown as Parseable;
  const upsertInput = { entityType: "account" as const, name: "Acme" };

  it("search accepts every status, including proposal and won", () => {
    expect(searchSchema.safeParse({ query: "acme", status: "proposal" }).success).toBe(true);
    expect(searchSchema.safeParse({ query: "acme", status: "won" }).success).toBe(true);
  });

  it("upsert accepts proposal but never won", () => {
    expect(upsertSchema.safeParse({ ...upsertInput, status: "proposal" }).success).toBe(true);
    expect(upsertSchema.safeParse({ ...upsertInput, status: "meeting" }).success).toBe(true);
    expect(upsertSchema.safeParse({ ...upsertInput, status: "won" }).success).toBe(false);
  });
});

describe("selectCronOperatorTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposeOutreach.mockResolvedValue({ error: "gated" });
  });

  it("passes cronRunId into proposeOutreach", async () => {
    const tools = selectCronOperatorTools({
      ...baseArgs,
      cronRunId: "run-1",
      version: { toolToggles: revenueToggles },
    });

    await tools.proposeAction!.execute!(
      {
        recordId: "aa0e8400-e29b-41d4-a716-446655440010",
        actionType: "outreach",
        channel: "copy",
        recipient: "ada@acme.com",
        body: "Hello",
        reason: "Fit",
        force: true,
      },
      { toolCallId: "call-1", messages: [], abortSignal: undefined },
    );

    expect(proposeOutreach).toHaveBeenCalledWith(
      expect.objectContaining({
        cronRunId: "run-1",
        agentId: baseArgs.agentId,
        companyId: baseArgs.companyId,
      }),
    );
    expect(proposeOutreach.mock.calls[0]![0].chatId).toBeUndefined();
  });

  it("gives the ad-manager tools only to a job of the ad-manager package", () => {
    const adTools = ["listAdCampaigns", "getAdPerformance", "getSearchTerms", "proposeAdChange"];
    const toolsFor = (packageSlug: string | null) =>
      Object.keys(
        selectCronOperatorTools({
          ...baseArgs,
          cronRunId: "run-1",
          version: { toolToggles: revenueToggles },
          packageSlug,
        }),
      );

    expect(toolsFor("ad-manager")).toEqual(expect.arrayContaining(adTools));
    for (const other of ["ad-monitor", "manager", null]) {
      const names = toolsFor(other);
      for (const name of adTools) expect(names, `${other}: ${name}`).not.toContain(name);
    }
  });
});
