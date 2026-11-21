import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/auth-server");

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { auth } from "@/lib/auth";
import { getSession, requireSession } from "./auth-server";

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when NextAuth has no user", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps NextAuth session to AppSession", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@relay.dev",
        image: null,
      },
      expires: "2026-09-01T00:00:00.000Z",
    } as never);

    await expect(getSession()).resolves.toEqual({
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@relay.dev",
        image: null,
      },
      session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
    });
  });
});

describe("requireSession", () => {
  it("redirects to /sign-in when missing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(requireSession()).rejects.toThrow("REDIRECT:/sign-in");
  });
});
