import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverHumanMessageOnWorker,
  forwardHandoffRecipientReply,
  forwardWhatsAppGroupWebhook,
  checkTeamChatAvailabilityOnWorker,
  ensureTeamChatGroupOnWorker,
  requestRecipientConfirmationOnWorker,
  requestHandoffFollowUpOnWorker,
  notifyWorkerComment,
  notifyWorkerInbound,
  proxyToWorker,
} from "./worker-proxy";

describe("proxyToWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when WORKER_URL is missing", async () => {
    vi.stubEnv("WORKER_URL", "");
    vi.stubEnv("WORKER_SECRET", "s");
    const res = await proxyToWorker({ kind: "customer" });
    expect(res.status).toBe(503);
    await expect(res.text()).resolves.toBe("Worker unavailable");
  });

  it("returns 503 when WORKER_SECRET is missing", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "");
    const res = await proxyToWorker({ kind: "customer" });
    expect(res.status).toBe(503);
  });

  it("pipes worker SSE and sends Bearer secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("stream", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToWorker({ kind: "operator", chatId: "c1" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://worker:3001/internal/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer s3cret",
        }),
      }),
    );
  });

  it("returns 502 when fetch throws", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await proxyToWorker({ kind: "customer" });
    expect(res.status).toBe(502);
  });
});

const INBOUND_BODY = {
  platform: "whatsapp" as const,
  chatId: "chat-1",
  channelId: "channel-1",
};

describe("notifyWorkerInbound", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "test-secret");
    fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts to /internal/inbound with the worker secret", async () => {
    expect(await notifyWorkerInbound(INBOUND_BODY)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://worker:3001/internal/inbound");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(init.body)).toEqual(INBOUND_BODY);
  });

  it("reports false when the worker rejects the notification", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));

    expect(await notifyWorkerInbound(INBOUND_BODY)).toBe(false);
  });

  it("reports false rather than throwing when the worker is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await notifyWorkerInbound(INBOUND_BODY)).toBe(false);
  });
});

const COMMENT_BODY = {
  channelId: "channel-1",
  commentId: "row-1",
};

describe("notifyWorkerComment", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "test-secret");
    fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts to /internal/comment with the worker secret", async () => {
    expect(await notifyWorkerComment(COMMENT_BODY)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://worker:3001/internal/comment");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(init.body)).toEqual(COMMENT_BODY);
  });

  it("reports false when the worker rejects the notification", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

    expect(await notifyWorkerComment(COMMENT_BODY)).toBe(false);
  });

  it("reports false rather than throwing when the worker is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await notifyWorkerComment(COMMENT_BODY)).toBe(false);
  });

  it("reports false when WORKER_URL is missing", async () => {
    vi.stubEnv("WORKER_URL", "");

    expect(await notifyWorkerComment(COMMENT_BODY)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deliverHumanMessageOnWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts the message id to the worker with the shared secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => new Response("Accepted", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await deliverHumanMessageOnWorker("msg-1")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://worker:3001/internal/handoff/deliver");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ messageId: "msg-1" });
  });

  it("never throws when the worker is unreachable or unconfigured", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deliverHumanMessageOnWorker("msg-1")).toBe(false);

    vi.stubEnv("WORKER_URL", "");
    expect(await deliverHumanMessageOnWorker("msg-1")).toBe(false);
  });
});

describe("requestHandoffFollowUpOnWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts the request id to the worker with the shared secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("Accepted", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHandoffFollowUpOnWorker("req-1")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://worker:3001/internal/handoff/follow-up",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer s3cret" }),
        body: JSON.stringify({ requestId: "req-1" }),
      }),
    );
  });

  it("never throws when the worker is down or unset", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(requestHandoffFollowUpOnWorker("req-1")).resolves.toBe(false);

    vi.stubEnv("WORKER_URL", "");
    await expect(requestHandoffFollowUpOnWorker("req-1")).resolves.toBe(false);
  });
});

describe("forwardHandoffRecipientReply", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const REPLY = {
    phoneNumberId: "106540352242922",
    fromWaId: "4915123456789",
    payload: "handoff_confirm:6f1c2a8e-1b2c-4d3e-8f90-123456789abc",
  };

  it("posts the tap to the worker with the shared secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => new Response("confirmed", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await forwardHandoffRecipientReply(REPLY)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://worker:3001/internal/handoff/recipient-reply");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual(REPLY);
  });

  it("never throws when the worker is down or unset", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(forwardHandoffRecipientReply(REPLY)).resolves.toBe(false);

    vi.stubEnv("WORKER_URL", "");
    await expect(forwardHandoffRecipientReply(REPLY)).resolves.toBe(false);
  });
});

describe("requestRecipientConfirmationOnWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const INPUT = { agentId: "agent-1", companyId: "company-1" };

  it("posts agent and company to the worker with the shared secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => new Response("sent", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestRecipientConfirmationOnWorker(INPUT)).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://worker:3001/internal/handoff/recipient-confirmation");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual(INPUT);
  });

  it.each([
    [202, "sent"],
    [409, "not_needed"],
    [404, "not_found"],
    [502, "failed"],
    [500, "failed"],
  ] as const)("maps worker %i to %s", async (status, outcome) => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status })));
    expect(await requestRecipientConfirmationOnWorker(INPUT)).toBe(outcome);
  });

  it("reports unavailable instead of throwing", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestRecipientConfirmationOnWorker(INPUT)).toBe("unavailable");

    vi.stubEnv("WORKER_URL", "");
    expect(await requestRecipientConfirmationOnWorker(INPUT)).toBe("unavailable");
  });
});

describe("forwardWhatsAppGroupWebhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts the verified body unchanged with the shared secret", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(await forwardWhatsAppGroupWebhook(raw)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://worker:3001/internal/whatsapp/groups");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(init.body).toBe(raw);
  });

  it("never throws when the worker is down or unset", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(forwardWhatsAppGroupWebhook("{}")).resolves.toBe(false);

    vi.stubEnv("WORKER_URL", "");
    await expect(forwardWhatsAppGroupWebhook("{}")).resolves.toBe(false);
  });
});

describe("Team chat on the worker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const INPUT = { agentId: "agent-1", companyId: "company-1" };

  it("asks the worker whether Team chat is available", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001/");
    vi.stubEnv("WORKER_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => Response.json({ available: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkTeamChatAvailabilityOnWorker(INPUT)).toEqual({ available: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://worker:3001/internal/handoff/team-chat-availability");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual(INPUT);
  });

  it("reads Team chat as unavailable when the worker refuses or is missing", async () => {
    vi.stubEnv("WORKER_URL", "");
    vi.stubEnv("WORKER_SECRET", "");
    expect(await checkTeamChatAvailabilityOnWorker(INPUT)).toEqual({ available: false, reason: "unavailable" });

    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: false, reason: "needs_oba" })));
    expect(await checkTeamChatAvailabilityOnWorker(INPUT)).toEqual({ available: false, reason: "needs_oba" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 404 })));
    expect(await checkTeamChatAvailabilityOnWorker(INPUT)).toEqual({ available: false, reason: "not_found" });
  });

  it("passes the group status through, whatever the HTTP status", async () => {
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "s");
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "active", inviteLink: "https://chat.whatsapp.com/ABC" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await ensureTeamChatGroupOnWorker(INPUT)).toEqual({
      status: "active",
      inviteLink: "https://chat.whatsapp.com/ABC",
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "http://worker:3001/internal/handoff/team-chat-group",
    );

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "needs_oba" }, { status: 409 })));
    expect(await ensureTeamChatGroupOnWorker(INPUT)).toEqual({ status: "needs_oba" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await ensureTeamChatGroupOnWorker(INPUT)).toEqual({ status: "unavailable" });
  });
});
