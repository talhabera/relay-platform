import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import * as dbModule from "@/db";
import {
  agentHandoffSettings,
  agents,
  chats,
  companies,
  handoffRequests,
  messages,
  portalEvents,
} from "@/db/schema";
import { expireDueHandoffRequests, openOrAppendHandoffRequest } from "@/lib/handoff/requests";
import { hashHandoffToken } from "@/lib/handoff/token";
import * as access from "@/lib/operator/access";
import { deliverHumanMessageOnWorker, requestHandoffFollowUpOnWorker } from "@/lib/worker-proxy";
import type { FakeDb } from "@/test-utils/fake-db";
import { POST as answerNow } from "@/app/api/client/answer-now/route";
import { GET as events } from "./events/route";
import { GET, POST } from "./route";

// S94 end to end: the quick-link lifecycle through the real route handlers,
// the real `lib/handoff` guards and state machine, against an in-memory
// database that evaluates the real WHERE clauses. Only the worker calls,
// rate-limit store and session are stubbed.

vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-db");
  const schema = await import("@relay/db/schema");
  const fake = createFakeDb({
    companies: schema.companies,
    chats: schema.chats,
    agents: schema.agents,
    messages: schema.messages,
    handoffRequests: schema.handoffRequests,
    agentHandoffSettings: schema.agentHandoffSettings,
    portalEvents: schema.portalEvents,
  });
  return { ...schema, schema, db: fake.db, __fake: fake };
});
vi.mock("@/lib/worker-proxy", () => ({
  deliverHumanMessageOnWorker: vi.fn(async () => true),
  requestHandoffFollowUpOnWorker: vi.fn(async () => true),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn(async () => ({ ok: true, release: async () => undefined })) };
});
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));

// Read through the namespace: only portal code names the client-access check (access-matrix guard).
const clientAccess = vi.mocked(access.requireClientAccess);
const fake = (dbModule as unknown as { __fake: FakeDb }).__fake;

const COMPANY = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const AGENT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const CHAT = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const T0 = new Date("2026-10-06T10:00:00Z");
const ASK = {
  reason: "Price is not in the price list",
  confidence: 40,
  question: "How much is the XL frame?",
  suggestedReplies: ["49 €"],
};

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

function req(token: string, body?: unknown): NextRequest {
  return new Request(`http://localhost/api/h/${token}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function open(token: string) {
  const res = await GET(req(token), params(token));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function act(token: string, body: unknown) {
  const res = await POST(req(token, body), params(token));
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

/** `ask_human`: open the conversation's request. Returns the raw link token. */
async function send(settings: Partial<typeof agentHandoffSettings.$inferInsert> = {}) {
  fake.seed(agentHandoffSettings, {
    agentId: AGENT,
    companyId: COMPANY,
    mode: "quick_answer",
    recipientName: "Lukas Weber",
    recipientWhatsapp: "+491701234567",
    recipientConfirmed: true,
    expiryMinutes: 120,
    defaultReply: "agent",
    recipientCanTakeOver: true,
    ...settings,
  });
  const opened = await openOrAppendHandoffRequest({ id: AGENT, companyId: COMPANY }, CHAT, ASK, new Date());
  if (opened.kind !== "opened" || !opened.token) throw new Error("expected a new request with a link");
  return opened.token;
}

function request() {
  const rows = fake.rows(handoffRequests);
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  fake.seed(companies, { id: COMPANY, name: "Acme GmbH", ownerId: "u-owner", timezone: "Europe/Berlin" });
  fake.seed(agents, { id: AGENT, companyId: COMPANY, name: "Acme Assistant", kind: "customer" });
  fake.seed(chats, { id: CHAT, companyId: COMPANY, agentId: AGENT, channelType: "widget", createdAt: at(-5) });
  fake.seed(messages, { chatId: CHAT, role: "user", content: "How much is the XL frame?", createdAt: at(-1) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handoff quick link, end to end", () => {
  it("send: opens one request, stores only the token hash, appends a second question", async () => {
    const token = await send();
    const row = request();
    expect(row.status).toBe("open");
    expect(row.tokenHash).toBe(hashHandoffToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt).toEqual(at(120));

    const again = await openOrAppendHandoffRequest(
      { id: AGENT, companyId: COMPANY },
      CHAT,
      { ...ASK, question: "And the M?" },
      new Date(),
    );
    expect(again.kind).toBe("appended");
    expect(request().questions).toHaveLength(2);

    const view = await open(token);
    expect(view.status).toBe(200);
    expect(view.headers.get("cache-control")).toBe("no-store");
    expect(view.headers.get("referrer-policy")).toBe("no-referrer");
    expect(view.body.link).toMatchObject({ canAnswer: true, canTakeOver: true, isExpired: false });
    expect(view.body.request.questions).toHaveLength(2);
    expect(JSON.stringify(view.body)).not.toContain("+491701234567");
    expect(JSON.stringify(view.body)).not.toContain(request().tokenHash as string);
    expect(view.body.transcript).toHaveLength(1);
  });

  it("opening the link is idempotent", async () => {
    const token = await send();
    const before = { ...request() };
    await open(token);
    await open(token);
    expect(request()).toEqual(before);
  });

  it("answer as the person: stored verbatim, delivered once, emits handoff_sent", async () => {
    const token = await send();
    vi.setSystemTime(at(10));
    const res = await act(token, { action: "answer", text: "49 € incl. VAT", replyMode: "person" });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("answered");
    expect(res.body.link.canAnswer).toBe(false);

    const human = fake.rows(messages).filter((m) => m.author === "human");
    expect(human).toHaveLength(1);
    expect(human[0]).toMatchObject({ content: "49 € incl. VAT", authorDisplayName: "Lukas Weber" });
    expect(deliverHumanMessageOnWorker).toHaveBeenCalledWith(human[0].id);
    expect(fake.rows(portalEvents).map((e) => e.type)).toEqual(["handoff_sent"]);
    expect(res.body.sent?.content).toBe("49 € incl. VAT");
  });

  it("answer phrased by the agent: no stored human message, the worker follows up", async () => {
    const token = await send();
    const res = await act(token, { action: "answer", text: "49", replyMode: "agent" });
    expect(res.status).toBe(200);
    expect(fake.rows(messages).some((m) => m.author === "human")).toBe(false);
    expect(requestHandoffFollowUpOnWorker).toHaveBeenCalledWith(request().id);
  });

  it("single answer: a second answer is a 409 and changes nothing", async () => {
    const token = await send();
    await act(token, { action: "answer", text: "49 €", replyMode: "person" });
    const second = await act(token, { action: "answer", text: "59 €", replyMode: "person" });
    expect(second.status).toBe(409);
    expect(request().answer).toBe("49 €");
    expect(fake.rows(messages).filter((m) => m.author === "human")).toHaveLength(1);
    expect(fake.rows(portalEvents)).toHaveLength(1);
  });

  it("takeover after an answer, live messages, typing, hand back", async () => {
    const token = await send();
    await act(token, { action: "answer", text: "49 €", replyMode: "person" });
    const taken = await act(token, { action: "take_over" });
    expect(taken.status).toBe(200);
    expect(taken.body.request.status).toBe("taken_over");
    // The answer already reported handoff_sent; the takeover does not again.
    expect(fake.rows(portalEvents)).toHaveLength(1);

    expect((await act(token, { action: "typing" })).status).toBe(204);
    const msg = await act(token, { action: "message", text: "I can also do 45 € today." });
    expect(msg.status).toBe(200);
    expect(msg.body.messageId).toBeTruthy();
    expect(deliverHumanMessageOnWorker).toHaveBeenLastCalledWith(msg.body.messageId);

    const back = await act(token, { action: "hand_back" });
    expect(back.status).toBe(200);
    expect(back.body.request).toMatchObject({ status: "handed_back", handBackReason: "manual" });
    // Handed back: no more messages, no second takeover.
    expect((await act(token, { action: "message", text: "late" })).status).toBe(409);
    expect((await act(token, { action: "take_over" })).status).toBe(409);
    expect((await act(token, { action: "typing" })).status).toBe(409);
  });

  it("takeover is refused when the agent does not allow it", async () => {
    const token = await send({ recipientCanTakeOver: false });
    expect((await open(token)).body.link.canTakeOver).toBe(false);
    expect((await act(token, { action: "take_over" })).status).toBe(409);
    expect(request().status).toBe("open");
  });

  it("message and typing are refused before a takeover", async () => {
    const token = await send();
    expect((await act(token, { action: "message", text: "hi" })).status).toBe(409);
    expect((await act(token, { action: "typing" })).status).toBe(409);
    expect(fake.rows(messages).some((m) => m.author === "human")).toBe(false);
  });

  it("Done closes the link for answering and taking over", async () => {
    const token = await send();
    const done = await act(token, { action: "done" });
    expect(done.status).toBe(200);
    expect(done.body.link).toMatchObject({ isClosed: true, canAnswer: false, canTakeOver: false, canView: false });
    expect(done.body.transcript).toBeNull();
    expect((await act(token, { action: "answer", text: "49", replyMode: "person" })).status).toBe(409);
    expect((await act(token, { action: "take_over" })).status).toBe(409);
  });

  it("expiry: past the deadline the link cannot act or show the chat, and the sweep expires it", async () => {
    const token = await send({ expiryMinutes: 30 });
    vi.setSystemTime(at(30));

    const view = await open(token);
    expect(view.status).toBe(200);
    expect(view.body.link).toMatchObject({ isExpired: true, canAnswer: false, canTakeOver: false, canView: false });
    expect(view.body.transcript).toBeNull();
    expect((await act(token, { action: "answer", text: "49", replyMode: "person" })).status).toBe(409);
    expect((await act(token, { action: "take_over" })).status).toBe(409);

    const stream = await events(req(token), params(token));
    expect(stream.status).toBe(410);

    const expired = await expireDueHandoffRequests(new Date());
    expect(expired.map((r) => r.id)).toEqual([request().id]);
    expect(request()).toMatchObject({ status: "expired" });
    expect((await open(token)).body.request.status).toBe("expired");
    // An answered request is not swept: it was answered in time.
    expect(await expireDueHandoffRequests(new Date())).toEqual([]);
  });

  it("an answer one millisecond before the deadline still counts", async () => {
    const token = await send({ expiryMinutes: 30 });
    vi.setSystemTime(new Date(at(30).getTime() - 1));
    expect((await act(token, { action: "answer", text: "49", replyMode: "person" })).status).toBe(200);
    vi.setSystemTime(at(31));
    expect(await expireDueHandoffRequests(new Date())).toEqual([]);
    expect(request().status).toBe("answered");
  });

  it("unknown, malformed and wrong tokens all read as 404", async () => {
    const token = await send();
    const other = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect((await open(other)).status).toBe(404);
    expect((await open("not-a-token")).status).toBe(404);
    expect((await open(hashHandoffToken(token))).status).toBe(404);
    expect((await act(other, { action: "answer", text: "x", replyMode: "person" })).status).toBe(404);
    expect((await act("../../etc", { action: "done" })).status).toBe(404);
    expect(request().status).toBe("open");
  });

  it("rejects malformed actions without touching the request", async () => {
    const token = await send();
    expect((await act(token, { action: "answer", text: "", replyMode: "person" })).status).toBe(400);
    expect((await act(token, { action: "answer", text: "x", replyMode: "boss" })).status).toBe(400);
    expect((await act(token, { action: "delete" })).status).toBe(400);
    expect(request().status).toBe("open");
  });

  it("Answer now: the client user's takeover rotates the token, so the recipient's link stops working", async () => {
    const recipientToken = await send();
    clientAccess.mockResolvedValue({
      session: { user: { id: "u-client", name: "Lena Vogel" } },
    } as never);

    const res = await answerNow(
      new Request("http://localhost/api/client/answer-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: COMPANY, chatId: CHAT }),
      }),
    );
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).not.toBe(recipientToken);
    expect(clientAccess).toHaveBeenCalledWith(COMPANY, { mutation: true });
    expect(request()).toMatchObject({ status: "taken_over", recipientName: "Lena Vogel" });

    expect((await open(recipientToken)).status).toBe(404);
    expect((await act(recipientToken, { action: "answer", text: "x", replyMode: "person" })).status).toBe(404);

    const msg = await act(token, { action: "message", text: "Lena here, 45 € works." });
    expect(msg.status).toBe(200);
    expect(fake.rows(messages).find((m) => m.id === msg.body.messageId)).toMatchObject({
      author: "human",
      authorDisplayName: "Lena Vogel",
    });

    // A second Answer now while the takeover runs is a conflict.
    const again = await answerNow(
      new Request("http://localhost/api/client/answer-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: COMPANY, chatId: CHAT }),
      }),
    );
    expect(again.status).toBe(409);
  });

  it("Answer now cannot reach another company's conversation", async () => {
    await send();
    clientAccess.mockResolvedValue({
      session: { user: { id: "u-other", name: "Mallory" } },
    } as never);
    const res = await answerNow(
      new Request("http://localhost/api/client/answer-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", chatId: CHAT }),
      }),
    );
    expect(res.status).toBe(404);
    expect(request().status).toBe("open");
  });
});
