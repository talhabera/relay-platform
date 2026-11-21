import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_PLACES_SEARCH_URL } from "../integrations/connectors/hosts";

const {
  findFirst,
  findMany,
  integrationsFindMany,
  updateSet,
  update,
  updateWhere,
  updateReturning,
  transitionLeadStatus,
  recordFallbackActor,
} = vi.hoisted(() => ({
  transitionLeadStatus: vi.fn(),
  recordFallbackActor: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  integrationsFindMany: vi.fn(),
  updateSet: vi.fn(),
  update: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    transitionLeadStatus,
    recordFallbackActor,
    db: {
      query: {
        companyRecords: { findFirst, findMany },
        integrations: { findMany: integrationsFindMany },
      },
      update,
    },
  };
});

import { runResearchPipeline } from "./research-pipeline";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const recordId = "aa0e8400-e29b-41d4-a716-446655440010";
const now = new Date("2026-09-03T12:00:00.000Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: recordId,
    companyId,
    sourceAgentId: "660e8400-e29b-41d4-a716-446655440001",
    entityType: "account" as const,
    name: "Acme",
    domain: null,
    payload: {},
    score: null,
    status: "pending" as const,
    researchedAt: null,
    nextFollowUpAt: null,
    researchAttemptCount: 0,
    researchLastError: null,
    researchLockedAt: null,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

function googlePlacesIntegration(apiKey = "gp-key") {
  return {
    id: "int-gp",
    type: "google_places" as const,
    status: "connected" as const,
    companyId,
    config: { googlePlaces: { apiKey } },
  };
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const urlString =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    return handler(urlString, init);
  }) as typeof fetch;
}

describe("runResearchPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(undefined);
    integrationsFindMany.mockResolvedValue([]);
    updateWhere.mockReturnValue({ returning: updateReturning });
    updateSet.mockReturnValue({ where: updateWhere });
    update.mockReturnValue({ set: updateSet });
    updateReturning.mockResolvedValue([]);
    recordFallbackActor.mockResolvedValue({ agentId: "agent-1" });
    // Stand-in for the real helper: one guarded update carrying the status.
    transitionLeadStatus.mockImplementation(
      async (
        _db: unknown,
        input: { toStatus: string; set?: Record<string, unknown> },
      ) => {
        const chain = update().set({ ...input.set, status: input.toStatus }).where();
        const rows = chain?.returning ? await chain.returning() : [{}];
        return rows.length > 0
          ? { changed: true, event: { id: "ev" } }
          : { changed: false, reason: "guard_failed" };
      },
    );
  });

  it("credits every status change to the agent running the research", async () => {
    findFirst.mockResolvedValue(record());
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      actor: { agentId: "runner" },
      fetchImpl: mockFetch(() => new Response(JSON.stringify({ places: [] }))),
    });

    const statuses = transitionLeadStatus.mock.calls.map((c) => c[1].toStatus);
    expect(statuses).toEqual(["processing", "researched"]);
    for (const call of transitionLeadStatus.mock.calls) {
      expect(call[1].actor).toEqual({ agentId: "runner" });
    }
    expect(recordFallbackActor).not.toHaveBeenCalled();
  });

  it("returns not_connected and reverts claim when all needed vendors are disconnected", async () => {
    findFirst.mockResolvedValue(record());
    updateReturning.mockResolvedValueOnce([{ id: recordId }]);

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "all",
      now,
      fetchImpl: mockFetch(() => new Response("{}")),
    });

    expect(result).toEqual({ error: "not_connected" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        researchLockedAt: null,
        researchAttemptCount: expect.anything(),
      }),
    );
  });

  it("sets domain from Places websiteUri and marks researched", async () => {
    findFirst.mockResolvedValue(record({ domain: null }));
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    const fetchImpl = mockFetch((url) => {
      if (url === GOOGLE_PLACES_SEARCH_URL) {
        return new Response(
          JSON.stringify({
            places: [{ websiteUri: "https://www.acme.com" }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: "researched" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "researched",
        researchedAt: now,
        researchLockedAt: null,
        researchLastError: null,
        domain: "acme.com",
        payload: {
          googlePlaces: { places: [{ websiteUri: "https://www.acme.com" }] },
        },
      }),
    );
  });

  it("keeps existing domain when Places returns a different website", async () => {
    findFirst.mockResolvedValue(record({ domain: "kept.com" }));
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    const fetchImpl = mockFetch((url) => {
      if (url === GOOGLE_PLACES_SEARCH_URL) {
        return new Response(
          JSON.stringify({
            places: [{ websiteUri: "https://other.com" }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: "researched" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          googlePlaces: { places: [{ websiteUri: "https://other.com" }] },
        },
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ domain: expect.anything() }),
    );
  });

  it("marks researched when Places domain conflicts on unique constraint", async () => {
    findFirst.mockResolvedValue(record({ domain: null }));
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    let whereCall = 0;
    updateWhere.mockImplementation(() => {
      whereCall += 1;
      if (whereCall === 2) {
        return Promise.reject(
          new Error("duplicate key value violates unique constraint"),
        );
      }
      return { returning: updateReturning };
    });

    const fetchImpl = mockFetch((url) => {
      if (url === GOOGLE_PLACES_SEARCH_URL) {
        return new Response(
          JSON.stringify({
            places: [{ websiteUri: "https://taken.com" }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: "researched" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "researched",
        researchedAt: now,
        researchLockedAt: null,
        researchLastError: null,
        payload: {
          googlePlaces: { places: [{ websiteUri: "https://taken.com" }] },
        },
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ domain: expect.anything() }),
    );
  });

  it("marks failed after max attempts when vendor keeps failing", async () => {
    findFirst.mockResolvedValue(record({ researchAttemptCount: 2 }));
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    const fetchImpl = mockFetch((url) => {
      if (url === GOOGLE_PLACES_SEARCH_URL) {
        return new Response("error", { status: 500 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: "failed" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        researchLockedAt: null,
        researchLastError: "http_500",
      }),
    );
  });

  it("marks researched when Places returns an empty success payload", async () => {
    findFirst.mockResolvedValue(record());
    updateReturning.mockResolvedValue([{ id: recordId }]);
    integrationsFindMany.mockResolvedValue([googlePlacesIntegration()]);

    const fetchImpl = mockFetch((url) => {
      if (url === GOOGLE_PLACES_SEARCH_URL) {
        return new Response("{}", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: "researched" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "researched",
        payload: { googlePlaces: {} },
      }),
    );
  });

  it("returns locked without calling vendor fetch when claim is locked", async () => {
    findFirst.mockResolvedValue(
      record({
        status: "processing",
        researchLockedAt: new Date(now.getTime() - 60_000),
      }),
    );
    const fetchImpl = mockFetch(() => {
      throw new Error("fetch should not be called");
    });

    const result = await runResearchPipeline({
      companyId,
      recordId,
      mode: "google_places",
      now,
      fetchImpl,
    });

    expect(result).toEqual({ error: "locked" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(integrationsFindMany).not.toHaveBeenCalled();
  });
});
