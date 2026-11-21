import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  handlers: {
    GET: vi.fn(() => new Response("auth-get", { status: 200 })),
    POST: vi.fn(() => new Response("auth-post", { status: 200 })),
  },
}));

describe("GET /api/auth/[...nextauth]", () => {
  it("exports GET and POST from NextAuth handlers", async () => {
    const { GET, POST } = await import("./route");
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });
});
