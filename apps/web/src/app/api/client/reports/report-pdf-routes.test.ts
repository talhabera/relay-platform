import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import type { ReportSnapshot } from "@/lib/fixtures/interfaces";
import { requireClientAccess } from "@/lib/operator/access";
import { getReportSnapshot } from "@/lib/reports/read";
import { enforceSurface } from "@/lib/rate-limit";

import { GET as getPdf } from "./[id]/pdf/route";
import { POST as postShare } from "./[id]/share/route";
import { GET as getShared } from "@/app/api/reports/shared/[token]/route";
import { signReportShareToken } from "@/app/api/reports/_lib/share-token";

const findCompany = vi.fn();

vi.mock("@/db", () => ({ db: { query: { companies: { findFirst: (...a: unknown[]) => findCompany(...a) } } } }));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/client/portal", () => ({ resolvePortalCompanyId: vi.fn() }));
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/reports/read", () => ({ getReportSnapshot: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn() };
});

const COMPANY = { id: "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60", name: "Acme", timezone: "Europe/Berlin" };
const SNAP_ID = "8f8b0a52-6a35-4bb4-9a0c-1c1d4a1f2e10";
const SNAPSHOT: ReportSnapshot = {
  id: SNAP_ID,
  companyId: COMPANY.id,
  period: "daily",
  start: new Date("2026-09-23T22:00:00Z"),
  end: new Date("2026-09-24T22:00:00Z"),
  metrics: [{ metricKey: "conversations.started", value: 19, previous: null }],
  series: { delivered: [], funnel: [] },
  narrative: null,
  frozenAt: new Date("2026-09-24T22:01:00Z"),
};
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 fake");

const fetchMock = vi.fn();
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKER_URL", "http://worker:3001/");
  vi.stubEnv("WORKER_SECRET", "ws");
  vi.stubEnv("REPORT_SHARE_SECRET", "share-secret");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(resolvePortalCompanyId).mockResolvedValue(COMPANY.id);
  vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "client" } as never);
  vi.mocked(getReportSnapshot).mockResolvedValue(SNAPSHOT);
  findCompany.mockResolvedValue(COMPANY);
  vi.mocked(enforceSurface).mockResolvedValue({ ok: true, release: async () => undefined });
});

const DENIED = {
  ok: false as const,
  denial: { allowed: false as const, kind: "rate" as const, policy: "x", limit: 10, windowSec: 60, retryAfterSec: 30 },
};

describe("report PDF rate limits (S94)", () => {
  it("limits the portal download per user before printing", async () => {
    vi.mocked(enforceSurface).mockResolvedValue(DENIED as never);
    const res = await getPdf(new Request("http://app/x"), params({ id: SNAP_ID }));
    expect(res.status).toBe(429);
    expect(enforceSurface).toHaveBeenCalledWith({
      rate: [{ policy: "report.pdf.user.minute", subject: "u1" }],
      leases: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits the public share link per client IP, a bad token included", async () => {
    vi.mocked(enforceSurface).mockResolvedValue(DENIED as never);
    const token = signReportShareToken(
      { snapshotId: SNAP_ID, companyId: COMPANY.id, expiresAt: new Date(Date.now() + 86_400_000) },
      "share-secret",
    )!;
    const res = await getShared(
      new Request("https://relay.example/x", { headers: { "x-forwarded-for": "203.0.113.7" } }),
      params({ token }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(enforceSurface).toHaveBeenCalledWith({
      rate: [{ policy: "report.pdf.shared.ip.minute", subject: "203.0.113.7" }],
      leases: [],
    });
    expect(getReportSnapshot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/client/reports/[id]/pdf", () => {
  it("prints the portal company's snapshot on the worker and downloads it", async () => {
    const res = await getPdf(new Request("http://app/api/client/reports/x/pdf"), params({ id: SNAP_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="relay-report-daily-2026-09-24.pdf"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY.id);
    expect(getReportSnapshot).toHaveBeenCalledWith(COMPANY.id, SNAP_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://worker:3001/internal/reports/pdf");
    expect(init.headers.Authorization).toBe("Bearer ws");
    expect(JSON.parse(init.body).html).toContain("Daily report");
  });

  it("refuses users without portal access", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    const res = await getPdf(new Request("http://app/x"), params({ id: SNAP_ID }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    vi.mocked(requireSession).mockRejectedValue(new Error("Unauthorized"));
    expect((await getPdf(new Request("http://app/x"), params({ id: SNAP_ID }))).status).toBe(401);
  });

  it("answers 404 for a snapshot of another company or an open period", async () => {
    vi.mocked(getReportSnapshot).mockResolvedValue(null);
    expect((await getPdf(new Request("http://app/x"), params({ id: SNAP_ID }))).status).toBe(404);
  });

  it("answers 502 when the worker cannot print", async () => {
    fetchMock.mockResolvedValue(new Response("PDF render failed", { status: 502 }));
    expect((await getPdf(new Request("http://app/x"), params({ id: SNAP_ID }))).status).toBe(502);
  });
});

describe("POST /api/client/reports/[id]/share + GET /api/reports/shared/[token]", () => {
  it("creates a 7-day link that opens the PDF without a session", async () => {
    const res = await postShare(
      new Request("https://relay.example/api/client/reports/x/share", { method: "POST" }),
      params({ id: SNAP_ID }),
    );
    expect(res.status).toBe(200);
    const { url, expiresAt } = (await res.json()) as { url: string; expiresAt: string };
    expect(url).toMatch(/^https:\/\/relay\.example\/api\/reports\/shared\/[\w-]+\.[\w-]+$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

    vi.mocked(requireSession).mockRejectedValue(new Error("no session"));
    const token = url.split("/").at(-1)!;
    const shared = await getShared(new Request(url), params({ token }));
    expect(shared.status).toBe(200);
    expect(shared.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(shared.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(getReportSnapshot).toHaveBeenLastCalledWith(COMPANY.id, SNAP_ID);
  });

  it("validates the requested lifetime", async () => {
    const res = await postShare(
      new Request("https://relay.example/x", { method: "POST", body: JSON.stringify({ days: 365 }) }),
      params({ id: SNAP_ID }),
    );
    expect(res.status).toBe(400);
    expect(getReportSnapshot).not.toHaveBeenCalled();
  });

  it("refuses to share a report the viewer cannot see", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    const res = await postShare(new Request("https://relay.example/x", { method: "POST" }), params({ id: SNAP_ID }));
    expect(res.status).toBe(403);
  });

  it("answers 404 for a forged or expired token", async () => {
    const expired = signReportShareToken(
      { snapshotId: SNAP_ID, companyId: COMPANY.id, expiresAt: new Date(Date.now() - 1000) },
      "share-secret",
    )!;
    for (const token of ["forged.token", expired]) {
      const res = await getShared(new Request("https://relay.example/x"), params({ token }));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 once the snapshot or company is gone", async () => {
    const token = signReportShareToken(
      { snapshotId: SNAP_ID, companyId: COMPANY.id, expiresAt: new Date(Date.now() + 60_000) },
      "share-secret",
    )!;
    findCompany.mockResolvedValue(undefined);
    expect((await getShared(new Request("https://relay.example/x"), params({ token }))).status).toBe(404);
  });
});
