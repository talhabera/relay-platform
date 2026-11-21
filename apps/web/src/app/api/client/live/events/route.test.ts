import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireClientAccess } from "@/lib/operator/access";
import { findFeedCursor, listPortalEventsFrom } from "@/lib/live/feed";
import { GET } from "./route";

vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/live/feed", () => ({ findFeedCursor: vi.fn(), listPortalEventsFrom: vi.fn() }));

const COMPANY = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const CURSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function event(id: string, at: string) {
  return {
    id,
    companyId: COMPANY,
    type: "lead_inbound_qualified",
    at: new Date(at),
    title: "Inbound lead qualified: Isar Data GmbH",
    detail: "Score 84 · from the website widget",
    channel: "widget",
    refId: "lead-1",
  };
}

async function firstChunks(res: Response, controller: AbortController): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(": keep-alive")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  controller.abort();
  await reader.cancel();
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientAccess).mockResolvedValue({ role: "client" } as never);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/client/live/events", () => {
  it("streams rows after the Last-Event-ID cursor as portal_event with ids", async () => {
    vi.mocked(findFeedCursor).mockResolvedValue({
      id: CURSOR_ID,
      at: new Date("2026-09-25T09:00:00Z"),
    });
    vi.mocked(listPortalEventsFrom).mockResolvedValue([
      event(CURSOR_ID, "2026-09-25T09:00:00Z"),
      event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-09-25T09:05:00Z"),
    ] as never);
    const controller = new AbortController();
    const res = await GET(
      new Request(`http://localhost/api/client/live/events?companyId=${COMPANY}`, {
        headers: { "last-event-id": CURSOR_ID },
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await firstChunks(res, controller);

    expect(findFeedCursor).toHaveBeenCalledWith(COMPANY, CURSOR_ID);
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY);
    expect(text).toContain("retry: 3000");
    expect(text).not.toContain(`id: ${CURSOR_ID}`);
    expect(text).toContain("id: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\nevent: portal_event\ndata: ");
    expect(text).toContain('"title":"Inbound lead qualified: Isar Data GmbH"');
  });

  it("refuses users without access before opening a stream", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    const res = await GET(
      new Request(`http://localhost/api/client/live/events?companyId=${COMPANY}`),
    );
    expect(res.status).toBe(403);
    expect(listPortalEventsFrom).not.toHaveBeenCalled();
  });

  it("rejects a malformed company id", async () => {
    const res = await GET(new Request("http://localhost/api/client/live/events?companyId=x"));
    expect(res.status).toBe(400);
  });
});
