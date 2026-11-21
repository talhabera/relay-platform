import { describe, expect, it } from "vitest";
import { authConfig } from "./auth.config";

describe("authConfig session callback", () => {
  it("copies JWT sub onto session.user.id so the proxy treats the request as logged in", async () => {
    const sessionCallback = authConfig.callbacks?.session;
    expect(sessionCallback).toEqual(expect.any(Function));

    const result = await sessionCallback!({
      session: {
        user: { name: "Ada", email: "ada@relay.dev", image: null },
        expires: "2026-09-01T00:00:00.000Z",
      },
      token: {
        sub: "user-relay-1",
        name: "Ada",
        email: "ada@relay.dev",
        picture: "https://example.com/ada.png",
      },
    } as never);

    expect(result.user?.id).toBe("user-relay-1");
    expect(result.user?.email).toBe("ada@relay.dev");
  });

  it("leaves session.user.id empty when the JWT has no sub", async () => {
    const result = await authConfig.callbacks!.session!({
      session: {
        user: { name: "Ada", email: "ada@relay.dev" },
        expires: "2026-09-01T00:00:00.000Z",
      },
      token: { name: "Ada", email: "ada@relay.dev" },
    } as never);

    expect(result.user?.id).toBe("");
  });

  it("copies the isClient claim so the proxy can send client users to the portal", async () => {
    const run = (token: Record<string, unknown>) =>
      authConfig.callbacks!.session!({
        session: {
          user: { name: "Ada", email: "ada@relay.dev" },
          expires: "2026-09-01T00:00:00.000Z",
        },
        token: { sub: "user-relay-1", ...token },
      } as never);

    expect(((await run({ isClient: true })) as { user?: { isClient?: boolean } }).user?.isClient).toBe(true);
    expect(((await run({ isClient: false })) as { user?: { isClient?: boolean } }).user?.isClient).toBe(false);
    expect(((await run({})) as { user?: { isClient?: boolean } }).user?.isClient).toBe(false);
  });
});
