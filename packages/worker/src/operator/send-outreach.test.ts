import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkpointFindFirst, integrationFindFirst, store, integrationUpdate } =
  vi.hoisted(() => ({
    checkpointFindFirst: vi.fn(),
    integrationFindFirst: vi.fn(),
    // The card's send_receipt column, as the guarded UPDATEs see it.
    store: { receipt: null as unknown },
    integrationUpdate: vi.fn(),
  }));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        checkpoints: { findFirst: checkpointFindFirst },
        integrations: { findFirst: integrationFindFirst },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            if (!("sendReceipt" in values)) {
              integrationUpdate(values);
              return Promise.resolve();
            }
            return {
              returning: async () => {
                const receipt = values.sendReceipt as { state: string } | null;
                if (receipt?.state === "sending" && store.receipt !== null) return [];
                store.receipt = receipt;
                return [{ id: "cp-1" }];
              },
            };
          },
        }),
      }),
    },
  };
});

import { parseSendOutreachBody, sendOutreach } from "./send-outreach";

const env = { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "cs" };

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "cp-1",
    companyId: "co-1",
    status: "approved",
    payload: {
      kind: "outreach",
      channel: "email",
      recipient: "ada@acme.com",
      subject: "Quick idea",
      body: "Hi Ada",
      reason: "Fit",
      recordName: "Acme",
      domain: "acme.com",
    },
    ...overrides,
  };
}

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: "int-1",
    status: "connected",
    config: {
      googleWorkspace: { refreshToken: "rt-1", email: "me@agency.com", scope: "gmail.send" },
    },
    ...overrides,
  };
}

function google(sendStatus = 200) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("oauth2")) {
      return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
    }
    return sendStatus === 200
      ? new Response(JSON.stringify({ id: "msg-1", threadId: "th-1" }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "quota" } }), { status: sendStatus });
  });
}

const sends = (fetchImpl: ReturnType<typeof google>) =>
  fetchImpl.mock.calls.filter(([url]) => String(url).includes("gmail.googleapis.com")).length;

beforeEach(() => {
  vi.clearAllMocks();
  store.receipt = null;
  checkpointFindFirst.mockImplementation(async () => card({ sendReceipt: store.receipt }));
  integrationFindFirst.mockResolvedValue(connector());
});

describe("parseSendOutreachBody", () => {
  it("needs a checkpoint id", () => {
    expect(parseSendOutreachBody({ checkpointId: "cp-1" })).toEqual({ checkpointId: "cp-1" });
    expect(parseSendOutreachBody({})).toBeNull();
  });
});

describe("sendOutreach", () => {
  it("sends the approved draft from the connected Gmail", async () => {
    const fetchImpl = google();
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toEqual({
      ok: true,
      result: {
        mode: "sent",
        channel: "email",
        provider: "gmail",
        from: "me@agency.com",
        recipient: "ada@acme.com",
        subject: "Quick idea",
        messageId: "msg-1",
        threadId: "th-1",
      },
    });
    const send = fetchImpl.mock.calls.find(([url]) => String(url).includes("gmail"))!;
    const raw = JSON.parse((send as unknown as [string, RequestInit])[1].body as string)
      .raw as string;
    const text = Buffer.from(raw, "base64url").toString("utf8");
    expect(text).toContain("From: me@agency.com");
    expect(text).toContain("To: ada@acme.com");
    expect(store.receipt).toMatchObject({ state: "sent" });
  });

  it("refuses a card web has not approved, other kinds and unknown cards", async () => {
    const fetchImpl = google();
    checkpointFindFirst.mockResolvedValueOnce(card({ status: "pending" }));
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 409 });
    checkpointFindFirst.mockResolvedValueOnce(card({ payload: { kind: "post" } }));
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 400 });
    checkpointFindFirst.mockResolvedValueOnce(undefined);
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses non-email outreach and a recipient that is not one address", async () => {
    const fetchImpl = google();
    checkpointFindFirst.mockResolvedValueOnce(
      card({ payload: { ...card().payload, channel: "whatsapp" } }),
    );
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 422 });
    checkpointFindFirst.mockResolvedValueOnce(
      card({ payload: { ...card().payload, recipient: "a@x.com, b@x.com" } }),
    );
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when Gmail is not connected or the OAuth client is missing", async () => {
    const fetchImpl = google();
    integrationFindFirst.mockResolvedValueOnce(undefined);
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 422 });
    integrationFindFirst.mockResolvedValueOnce(connector({ status: "error" }));
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 422 });
    await expect(sendOutreach("cp-1", { fetchImpl, env: {} })).resolves.toMatchObject({
      status: 422,
      error: "Google sign-in is not configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("marks the connector errored when Google revoked access", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({
      ok: false,
      status: 422,
    });
    expect(integrationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(store.receipt).toBeNull();
  });

  it("clears the marker after a failed send, so Retry can send", async () => {
    const failing = google(500);
    await expect(sendOutreach("cp-1", { fetchImpl: failing, env })).resolves.toMatchObject({
      ok: false,
      status: 502,
    });
    expect(store.receipt).toBeNull();
    await expect(sendOutreach("cp-1", { fetchImpl: google(), env })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("sends once per card and returns the earlier result on a repeat", async () => {
    const fetchImpl = google();
    const first = await sendOutreach("cp-1", { fetchImpl, env });
    const second = await sendOutreach("cp-1", { fetchImpl, env });
    expect(second).toEqual(first);
    expect(sends(fetchImpl)).toBe(1);
  });

  it("never sends while an earlier attempt holds the marker", async () => {
    store.receipt = { state: "sending", at: "2026-10-03T00:00:00.000Z" };
    const fetchImpl = google();
    await expect(sendOutreach("cp-1", { fetchImpl, env })).resolves.toMatchObject({ status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
