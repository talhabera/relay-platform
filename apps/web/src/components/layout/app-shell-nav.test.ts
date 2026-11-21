import { describe, expect, it } from "vitest";

import { resolveNavItems } from "@/components/v2/shell/nav-pill";
import type { PagePermissionKey } from "@/db/schema";

import { activeNavKey, resolveShellNav } from "./app-shell-nav";

const grants = (...keys: PagePermissionKey[]) => (page: PagePermissionKey) => keys.includes(page);
const all = () => true;
const visible = (nav: ReturnType<typeof resolveShellNav>) =>
  resolveNavItems({ role: nav.role, show: nav.show }).map((item) => item.key);

describe("activeNavKey", () => {
  it.each([
    ["/home", "home"],
    ["/operator", "operator"],
    ["/operator/agents/abc", "operator"],
    ["/needs-you", "operator"],
    ["/messaging", "inbox"],
    ["/analytics", "analytics"],
    ["/agents/123", "agents"],
    ["/settings/profile", "none"],
    ["/companies", "none"],
    ["/homepage", "none"],
  ])("%s -> %s", (pathname, key) => {
    expect(activeNavKey(pathname)).toBe(key);
  });
});

describe("resolveShellNav member gating", () => {
  it("owner sees all five tabs", () => {
    const nav = resolveShellNav({ isOwner: true, hasPageAccess: all, pathname: "/home" });
    expect(nav.role).toBe("owner");
    expect(visible(nav)).toEqual(["home", "operator", "inbox", "analytics", "agents"]);
    expect(nav.active).toBe("home");
  });

  it("member with every grant still never sees Agents", () => {
    const nav = resolveShellNav({ isOwner: false, hasPageAccess: all, pathname: "/operator" });
    expect(nav.role).toBe("member");
    expect(visible(nav)).toEqual(["home", "operator", "inbox", "analytics"]);
  });

  it("member without grants sees only Home", () => {
    const nav = resolveShellNav({ isOwner: false, hasPageAccess: grants(), pathname: "/home" });
    expect(visible(nav)).toEqual(["home"]);
  });

  it("maps page permission keys onto tabs (messaging -> Inbox)", () => {
    const nav = resolveShellNav({
      isOwner: false,
      hasPageAccess: grants("messaging", "analytics"),
      pathname: "/messaging",
    });
    expect(visible(nav)).toEqual(["home", "inbox", "analytics"]);
    expect(nav.active).toBe("inbox");
  });

  it("an ungranted gated route keeps no active tab (page-restricted, not redirected)", () => {
    const nav = resolveShellNav({ isOwner: false, hasPageAccess: grants(), pathname: "/analytics" });
    expect(nav.active).toBe("none");
  });
});
