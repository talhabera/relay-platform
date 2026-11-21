import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { accessRequests } from "@/db/schema";
import { assertWithinLimits, RateLimitError } from "@/lib/rate-limit";
import { requestAccess } from "./actions";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, assertWithinLimits: vi.fn() };
});

const valid = {
  name: "  Ada Lovelace ",
  email: "  Ada@Agency.EXAMPLE ",
  agencyName: "Analytical Agency",
  clientCount: "6-20",
  plan: "pro",
  message: "We run 12 shops.",
};

function mockUpsert(inserted = true) {
  const returning = vi.fn().mockResolvedValue([{ id: "req-1", inserted }]);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  vi.mocked(db.insert).mockReturnValueOnce({ values } as never);
  return { values, onConflictDoUpdate, returning };
}

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock("@relay/agent-ops/shared/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@relay/agent-ops/shared/mailer")>()),
  sendMail: sendMailMock,
}));

describe("requestAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertWithinLimits).mockResolvedValue(undefined);
    sendMailMock.mockResolvedValue({ id: "<m1@purelymail>" });
    vi.stubEnv("SMTP_USER", "relay@relay.example");
    vi.stubEnv("SMTP_PASS", "pw");
    vi.stubEnv("ACCESS_REQUEST_INBOX", "beta@relay.example");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("WORKER_URL", "http://worker:3001");
    vi.stubEnv("WORKER_SECRET", "test-secret");
  });

  it("stores a lowercased, trimmed request and upserts on email", async () => {
    const { values, onConflictDoUpdate } = mockUpsert();

    const result = await requestAccess(valid);

    expect(result).toEqual({ ok: true, name: "Ada Lovelace", email: "ada@agency.example" });
    expect(db.insert).toHaveBeenCalledWith(accessRequests);
    expect(values).toHaveBeenCalledWith({
      email: "ada@agency.example",
      name: "Ada Lovelace",
      agencyName: "Analytical Agency",
      clientCount: "6-20",
      plan: "pro",
      message: "We run 12 shops.",
    });
    const conflict = (onConflictDoUpdate.mock.calls[0] as unknown[])[0] as {
      target: unknown;
      set: Record<string, unknown>;
    };
    expect(conflict.target).toBe(accessRequests.email);
    // A repeat request refreshes the details and keeps status.
    expect(Object.keys(conflict.set).sort()).toEqual(
      ["agencyName", "clientCount", "message", "name", "plan", "updatedAt"].sort(),
    );
    expect(conflict.set.updatedAt).toBeInstanceOf(Date);
  });

  it("accepts FormData and defaults plan to none, empty message to null", async () => {
    const { values } = mockUpsert();
    const form = new FormData();
    form.set("name", "Ada");
    form.set("email", "ada@agency.example");
    form.set("agencyName", "Analytical");
    form.set("clientCount", "1");
    form.set("message", "  ");
    form.set("website", "");

    const result = await requestAccess(form);

    expect(result.ok).toBe(true);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "none", message: null, clientCount: "1" }),
    );
  });

  it("rate-limits per client IP before storing", async () => {
    vi.mocked(assertWithinLimits).mockRejectedValueOnce(
      new RateLimitError({
        kind: "rate",
        policy: "access_request.ip.hour",
        limit: 5,
        retryAfterSec: 1800,
      } as never),
    );

    const result = await requestAccess(valid);

    expect(result).toEqual({ ok: false, error: "rate_limited", retryAfterSec: 1800 });
    expect(assertWithinLimits).toHaveBeenCalledWith({
      rate: [{ policy: "access_request.ip.hour", subject: "203.0.113.7" }],
      leases: [],
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("returns success and stores nothing when the honeypot is filled", async () => {
    const result = await requestAccess({ ...valid, website: "http://spam.example" });

    expect(result).toEqual({ ok: true, name: "Ada Lovelace", email: "ada@agency.example" });
    expect(db.insert).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(assertWithinLimits).not.toHaveBeenCalled();
  });

  it("rejects invalid input with field errors", async () => {
    const result = await requestAccess({
      ...valid,
      email: "not-an-email",
      clientCount: "100",
      plan: "gold",
      name: "",
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid") throw new Error("expected invalid");
    expect(Object.keys(result.fieldErrors).sort()).toEqual(
      ["clientCount", "email", "name", "plan"].sort(),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("emails ACCESS_REQUEST_INBOX over SMTP with reply-to the requester", async () => {
    mockUpsert(false);

    await requestAccess(valid);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [config, message] = sendMailMock.mock.calls[0];
    expect(config).toMatchObject({ host: "smtp.purelymail.com", user: "relay@relay.example" });
    expect(message.to).toBe("beta@relay.example");
    expect(message.from).toBe("Relay <relay@relay.example>");
    expect(message.replyTo).toBe("ada@agency.example");
    expect(message.subject).toContain("Updated access request");
    expect(message.text).toContain("Analytical Agency");
    expect(message.text).toContain("Plan: pro");
  });

  it("stores the row and skips the send when ACCESS_REQUEST_INBOX is unset", async () => {
    vi.stubEnv("ACCESS_REQUEST_INBOX", "");
    const { values } = mockUpsert();

    const result = await requestAccess(valid);

    expect(result.ok).toBe(true);
    expect(values).toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("ACCESS_REQUEST_INBOX"));
  });

  it("still succeeds when the SMTP send fails (the row is stored)", async () => {
    mockUpsert();
    sendMailMock.mockRejectedValueOnce(new Error("535 auth failed"));

    const result = await requestAccess(valid);

    expect(result.ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns a failure when the database write throws", async () => {
    vi.mocked(db.insert).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const result = await requestAccess(valid);

    expect(result).toEqual({ ok: false, error: "failed" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
