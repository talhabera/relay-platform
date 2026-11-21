import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCompanyAccess, saveGoogleWorkspaceConnector, exchangeGoogleCode } = vi.hoisted(
  () => ({
    requireCompanyAccess: vi.fn(),
    saveGoogleWorkspaceConnector: vi.fn(),
    exchangeGoogleCode: vi.fn(),
  }),
);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@relay/agent-ops/auth/access", () => ({ requireCompanyAccess }));
vi.mock("@/lib/integrations/google-workspace-connector", () => ({
  saveGoogleWorkspaceConnector,
}));
vi.mock("@/lib/integrations/google-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google-workspace")>();
  return { ...actual, exchangeGoogleCode };
});

import { getSession } from "@/lib/auth-server";
import { createOAuthState } from "@/lib/integrations/google-workspace";
import { GET } from "./route";
import { GET as START } from "../start/route";

const SECRET = "test-auth-secret";

function session(id = "user-1") {
  return { user: { id, name: "Owner", email: "o@x.com" }, session: { expiresAt: new Date() } };
}

function callback(params: Record<string, string>) {
  const url = new URL("https://app.relay.dev/api/connectors/google-workspace/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

function redirectTarget(res: Response) {
  return new URL(res.headers.get("location") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_URL", "https://app.relay.dev");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret");
  vi.mocked(getSession).mockResolvedValue(session() as never);
  requireCompanyAccess.mockResolvedValue({ company: { id: "co-1" } });
  exchangeGoogleCode.mockResolvedValue({
    ok: true,
    refreshToken: "rt-1",
    email: "me@agency.com",
    scope: "gmail.send",
  });
});

describe("GET /api/connectors/google-workspace/start", () => {
  it("sends the owner to Google's consent with a signed state", async () => {
    const res = await START(
      new Request("https://app.relay.dev/api/connectors/google-workspace/start?companyId=co-1"),
    );
    expect(res.status).toBe(302);
    const target = redirectTarget(res);
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://app.relay.dev/api/connectors/google-workspace/callback",
    );
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(requireCompanyAccess).toHaveBeenCalledWith("user-1", "co-1");
  });

  it("refuses someone who does not own the company", async () => {
    requireCompanyAccess.mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await START(
      new Request("https://app.relay.dev/api/connectors/google-workspace/start?companyId=co-2"),
    );
    expect(res.status).toBe(403);
  });

  it("explains when Google sign-in is not configured", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    const res = await START(
      new Request("https://app.relay.dev/api/connectors/google-workspace/start?companyId=co-1"),
    );
    expect(redirectTarget(res).searchParams.get("connectorError")).toMatch(/isn't set up/);
  });
});

describe("GET /api/connectors/google-workspace/callback", () => {
  it("stores the grant and returns to Connectors", async () => {
    const state = createOAuthState({ companyId: "co-1", userId: "user-1" }, SECRET);
    const res = await GET(callback({ code: "c1", state }));
    expect(saveGoogleWorkspaceConnector).toHaveBeenCalledWith("co-1", {
      refreshToken: "rt-1",
      email: "me@agency.com",
      scope: "gmail.send",
    });
    const target = redirectTarget(res);
    expect(target.pathname).toBe("/settings/connectors");
    expect(target.searchParams.get("connected")).toBe("google_workspace");
  });

  it("refuses a state started by someone else", async () => {
    const state = createOAuthState({ companyId: "co-1", userId: "attacker" }, SECRET);
    const res = await GET(callback({ code: "c1", state }));
    expect(redirectTarget(res).searchParams.get("connectorError")).toBeTruthy();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(saveGoogleWorkspaceConnector).not.toHaveBeenCalled();
  });

  it("stores nothing when the owner cancels or the exchange fails", async () => {
    const state = createOAuthState({ companyId: "co-1", userId: "user-1" }, SECRET);
    await GET(callback({ error: "access_denied", state }));
    exchangeGoogleCode.mockResolvedValueOnce({ ok: false, error: "Allow Relay to send email" });
    const res = await GET(callback({ code: "c1", state }));
    expect(redirectTarget(res).searchParams.get("connectorError")).toBe(
      "Allow Relay to send email",
    );
    expect(saveGoogleWorkspaceConnector).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    const res = await GET(callback({ code: "c1", state: "x" }));
    expect(res.status).toBe(401);
  });
});
