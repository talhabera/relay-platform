import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import { companies, companyMembers, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { gateRequest } from "@/lib/auth-paths";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { loadClientNotifications } from "@/lib/client/notifications-data";
import { answerNowAsCompanyUser } from "@/lib/handoff/requests";
import { listPortalEvents, listPortalEventsFrom, portalEventsReader } from "@/lib/live/feed";
import { getLiveSummary } from "@/lib/live/summary";
import { findReportPage, getReportSnapshot, listReportArchive } from "@/lib/reports/read";
import { reportPdfResponse } from "@/app/api/reports/_lib/report-pdf";
import type { FakeDb } from "@/test-utils/fake-db";

import { GET as liveGET } from "@/app/api/client/live/route";
import { GET as liveEventsGET } from "@/app/api/client/live/events/route";
import { POST as answerNowPOST } from "@/app/api/client/answer-now/route";
import { GET as reportPdfGET } from "@/app/api/client/reports/[id]/pdf/route";
import { POST as reportSharePOST } from "@/app/api/client/reports/[id]/share/route";
import { loadLivePage } from "./live/load-live";
import { loadReportsPage } from "./reports/load-report";
import { loadArchivePage } from "./reports/archive/load-archive";
import { loadClientNotificationsPage, loadClientProfile } from "./profile/load-profile";
import { markNotificationsSeen, saveWhatsappNumber, setReportEmails } from "./profile/actions";

// S94 authorization matrix: every `/client/*` page (through its loader) and
// every `/api/client/*` handler, against every kind of viewer. The real
// `requireClientAccess` runs on an in-memory database; only the data each
// surface reads after the check is stubbed. A new page or handler fails the
// inventory test until it is added to the matrix.

vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-db");
  const schema = await import("@relay/db/schema");
  const fake = createFakeDb({
    companies: schema.companies,
    companyMembers: schema.companyMembers,
    users: schema.users,
    chats: schema.chats,
    messages: schema.messages,
    agents: schema.agents,
    handoffRequests: schema.handoffRequests,
    portalEvents: schema.portalEvents,
  });
  return { ...schema, schema, db: fake.db, __fake: fake };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/client/portal", () => ({ resolvePortalCompanyId: vi.fn() }));
vi.mock("@/lib/live/summary", () => ({ getLiveSummary: vi.fn() }));
vi.mock("@/lib/live/feed", () => {
  const listPortalEvents = vi.fn(async () => []);
  return {
    FEED_DEFAULT_LIMIT: 30,
    listPortalEvents,
    portalEventsReader: { listPortalEvents },
    findFeedCursor: vi.fn(async () => null),
    listPortalEventsFrom: vi.fn(async () => []),
  };
});
vi.mock("@/lib/reports/read", () => ({
  findReportPage: vi.fn(async () => null),
  listReportArchive: vi.fn(async () => []),
  getReportSnapshot: vi.fn(),
}));
vi.mock("@/lib/client/notifications-data", () => ({ loadClientNotifications: vi.fn() }));
vi.mock("@/lib/handoff/requests", () => ({ answerNowAsCompanyUser: vi.fn() }));
vi.mock("@/app/api/reports/_lib/report-pdf", () => ({
  NO_STORE: { "Cache-Control": "no-store" },
  reportPdfResponse: vi.fn(async () => new Response("%PDF-", { status: 200 })),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn(async () => ({ ok: true, release: async () => undefined })) };
});

const fake = (dbModule as unknown as { __fake: FakeDb }).__fake;

const A = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const B = "5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716";
const CHAT = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const SNAP = "8f8b0a52-6a35-4bb4-9a0c-1c1d4a1f2e10";

type Persona = "anonymous" | "outsider" | "clientOfB" | "memberOfA" | "ownerOfA" | "clientOfA";
const PERSONAS: Persona[] = ["anonymous", "outsider", "clientOfB", "memberOfA", "ownerOfA", "clientOfA"];
const USER: Record<Exclude<Persona, "anonymous">, string> = {
  outsider: "u-outsider",
  clientOfB: "u-client-b",
  memberOfA: "u-member-a",
  ownerOfA: "u-owner-a",
  clientOfA: "u-client-a",
};

/** Who passes: portal reads let the owner / member preview in; writes are client users only. */
type Audience = "portal-read" | "client-write" | "signed-in";
const ALLOWED: Record<Audience, Persona[]> = {
  "portal-read": ["memberOfA", "ownerOfA", "clientOfA"],
  "client-write": ["clientOfA"],
  "signed-in": ["outsider", "clientOfB", "memberOfA", "ownerOfA", "clientOfA"],
};

type Outcome = "allow" | "deny";

/** Run one surface; a throw or a 401/403 is a denial. */
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    const result = await run();
    if (result instanceof Response) {
      await result.body?.cancel().catch(() => undefined);
      if (result.status === 401 || result.status === 403) return "deny";
      expect(result.status, "unexpected status").toBeLessThan(400);
    }
    return "allow";
  } catch {
    return "deny";
  }
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const id = { params: Promise.resolve({ id: SNAP }) };

type Surface = { route: string; audience: Audience; run: () => Promise<unknown> };

const SURFACES: Surface[] = [
  // Pages: each `page.tsx` renders its loader's result.
  { route: "page /client/live", audience: "portal-read", run: () => loadLivePage({ event: null, chat: null }) },
  { route: "page /client/live/preview", audience: "portal-read", run: () => loadLivePage({ event: null, chat: CHAT }) },
  { route: "page /client/reports", audience: "portal-read", run: () => loadReportsPage({ period: "daily", id: null }) },
  { route: "page /client/reports/archive", audience: "portal-read", run: () => loadArchivePage({ period: "all" } as never) },
  { route: "page /client/profile", audience: "portal-read", run: () => loadClientProfile() },
  { route: "page /client/profile/notifications", audience: "portal-read", run: () => loadClientNotificationsPage() },
  // Server actions behind those pages.
  { route: "action saveWhatsappNumber", audience: "signed-in", run: () => saveWhatsappNumber("+491701234567") },
  { route: "action setReportEmails", audience: "client-write", run: () => setReportEmails(A, false) },
  { route: "action markNotificationsSeen", audience: "portal-read", run: () => markNotificationsSeen(A) },
  // API handlers: the company comes from the request, so the attacker names A.
  {
    route: "GET /api/client/live",
    audience: "portal-read",
    run: () => liveGET(new Request(`http://app/api/client/live?companyId=${A}`)),
  },
  {
    route: "GET /api/client/live/events",
    audience: "portal-read",
    run: () => liveEventsGET(new Request(`http://app/api/client/live/events?companyId=${A}`)),
  },
  {
    route: "POST /api/client/answer-now",
    audience: "client-write",
    run: () => answerNowPOST(new Request("http://app/api/client/answer-now", json({ companyId: A, chatId: CHAT }))),
  },
  {
    route: "GET /api/client/reports/[id]/pdf",
    audience: "portal-read",
    run: () => reportPdfGET(new Request("http://app/x"), id),
  },
  {
    route: "POST /api/client/reports/[id]/share",
    audience: "portal-read",
    run: () => reportSharePOST(new Request("http://app/x", { method: "POST" }), id),
  },
];

/** Every stub that only runs after a passed check. */
const DOWNSTREAM = () => [
  getLiveSummary,
  listPortalEvents,
  portalEventsReader.listPortalEvents,
  listPortalEventsFrom,
  findReportPage,
  listReportArchive,
  getReportSnapshot,
  loadClientNotifications,
  answerNowAsCompanyUser,
  reportPdfResponse,
];

function signIn(persona: Persona) {
  if (persona === "anonymous") {
    vi.mocked(requireSession).mockRejectedValue(new Error("Unauthorized"));
    return;
  }
  const userId = USER[persona];
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: userId, name: persona, email: `${persona}@example.com` },
  } as never);
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  vi.stubEnv("REPORT_SHARE_SECRET", "share-secret");
  fake.seed(companies, { id: A, name: "Acme GmbH", ownerId: USER.ownerOfA, timezone: "Europe/Berlin" });
  fake.seed(companies, { id: B, name: "Beta AG", ownerId: "u-owner-b", timezone: "UTC" });
  for (const userId of Object.values(USER)) fake.seed(users, { id: userId, name: userId, email: `${userId}@x` });
  fake.seed(companyMembers, { companyId: A, userId: USER.memberOfA, role: "member" });
  fake.seed(companyMembers, { companyId: A, userId: USER.clientOfA, role: "client" });
  fake.seed(companyMembers, { companyId: B, userId: USER.clientOfB, role: "client" });

  // Worst case for page loaders: every viewer's portal resolves to company A,
  // so `requireClientAccess` alone has to keep the wrong people out.
  vi.mocked(resolvePortalCompanyId).mockResolvedValue(A);
  vi.mocked(getLiveSummary).mockResolvedValue({ timeZone: "Europe/Berlin" } as never);
  vi.mocked(getReportSnapshot).mockResolvedValue({ id: SNAP, companyId: A } as never);
  vi.mocked(loadClientNotifications).mockResolvedValue({} as never);
  vi.mocked(answerNowAsCompanyUser).mockResolvedValue({ ok: true, token: "t", request: { id: "r" } } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("client portal authorization matrix", () => {
  for (const surface of SURFACES) {
    describe(surface.route, () => {
      it.each(PERSONAS)("%s", async (persona) => {
        signIn(persona);
        const membersBefore = JSON.stringify(fake.rows(companyMembers));
        const usersBefore = JSON.stringify(fake.rows(users));

        const expected: Outcome = ALLOWED[surface.audience].includes(persona) ? "allow" : "deny";
        expect(await outcome(surface.run)).toBe(expected);

        if (expected === "deny") {
          for (const stub of DOWNSTREAM()) expect(stub).not.toHaveBeenCalled();
          expect(JSON.stringify(fake.rows(companyMembers))).toBe(membersBefore);
          expect(JSON.stringify(fake.rows(users))).toBe(usersBefore);
        }
      });
    });
  }

  it("data reads after a passed check are scoped to the company that was checked", async () => {
    signIn("clientOfA");
    await loadLivePage({ event: null, chat: null });
    await liveGET(new Request(`http://app/api/client/live?companyId=${A}`));
    await reportPdfGET(new Request("http://app/x"), id);
    for (const call of vi.mocked(getLiveSummary).mock.calls) expect(call[0]).toBe(A);
    for (const call of vi.mocked(getReportSnapshot).mock.calls) expect(call[0]).toBe(A);
  });

  it("writes touch only the viewer's own rows", async () => {
    signIn("clientOfA");
    await setReportEmails(A, false);
    await saveWhatsappNumber("+491701234567");
    const members = fake.rows(companyMembers);
    expect(members.filter((m) => m.reportEmailOptOut === true).map((m) => m.userId)).toEqual([USER.clientOfA]);
    expect(fake.rows(users).filter((u) => u.whatsappNumber).map((u) => u.id)).toEqual([USER.clientOfA]);
  });

  it("a client of A cannot set B's report emails even while holding a client row elsewhere", async () => {
    fake.seed(companyMembers, { companyId: B, userId: USER.clientOfA, role: "client" });
    signIn("clientOfB");
    expect(await outcome(() => setReportEmails(A, false))).toBe("deny");
  });
});

describe("client portal inventory", () => {
  const appDir = join(__dirname, "..");

  function walk(dir: string, file: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path, file);
      return name === file ? [relative(appDir, dir).split(sep).join("/")] : [];
    });
  }

  it("every /client page is in the matrix", () => {
    const pages = walk(join(appDir, "client"), "page.tsx").map((dir) => `page /${dir}`);
    const covered = SURFACES.map((s) => s.route).filter((r) => r.startsWith("page "));
    expect(pages.sort()).toEqual(covered.sort());
  });

  it("every /api/client handler is in the matrix", async () => {
    const routes = walk(join(appDir, "api", "client"), "route.ts");
    const handlers: string[] = [];
    for (const dir of routes) {
      const mod = (await import(`@/app/${dir}/route`)) as Record<string, unknown>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (typeof mod[method] === "function") handlers.push(`${method} /${dir}`);
      }
    }
    const covered = SURFACES.map((s) => s.route).filter((r) => r.includes(" /api/"));
    expect(handlers.sort()).toEqual(covered.sort());
  });
});

describe("edge gate for portal paths", () => {
  const paths = ["/client/reports", "/client/live", "/client/profile/notifications", "/api/client/live"];

  it.each(paths)("anonymous on %s is sent to sign-in or refused", (path) => {
    expect(gateRequest(path, false)).toEqual(
      path.startsWith("/api/") ? { type: "unauthorized" } : { type: "redirect", to: "/sign-in" },
    );
  });

  it.each(["/home", "/agents", "/operator", "/messaging", "/settings"])(
    "a client user on %s is sent back to the portal",
    (path) => {
      expect(gateRequest(path, true, { isClient: true })).toEqual({ type: "redirect", to: "/client/reports" });
    },
  );

  it.each([...paths, "/h/abc"])("a client user may open %s", (path) => {
    expect(gateRequest(path, true, { isClient: true })).toEqual({ type: "next" });
  });

  it.each(["/h/abc", "/api/h/abc", "/api/reports/shared/abc"])("%s is public (the token is the credential)", (path) => {
    expect(gateRequest(path, false)).toEqual({ type: "next" });
  });
});
