import { describe, expect, it } from "vitest";
import { gateRequest, isAuthPath, isPublicPath } from "./auth-paths";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/pricing",
    "/blog",
    "/blog/hello",
    "/sign-in",
    "/sign-up",
    "/api/auth",
    "/api/auth/callback/nexauth",
    "/api/widget/abc/chat",
    "/api/webhooks/instagram",
    "/widget.js",
    "/company-widget/wid_123",
    "/h/tok_123",
    "/api/h/tok_123",
    "/api/h/tok_123/events",
    "/api/reports/shared/abc.def",
  ])("allows %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/api/chat",
    "/settings/profile",
    "/agents",
    "/operator",
    "/home",
    "/api/webhooksfake",
    "/api/hx",
    "/api/client/answer-now",
    "/api/client/reports/snap-1/pdf",
    "/api/client/reports/snap-1/share",
    "/api/reports/shared",
  ])("protects %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("isAuthPath", () => {
  it("matches sign-in and sign-up only", () => {
    expect(isAuthPath("/sign-in")).toBe(true);
    expect(isAuthPath("/sign-up")).toBe(true);
    expect(isAuthPath("/dashboard")).toBe(false);
  });
});

describe("gateRequest", () => {
  it("sends authenticated users away from sign-in", () => {
    expect(gateRequest("/sign-in", true)).toEqual({
      type: "redirect",
      to: "/home",
    });
  });

  it("returns 401 for unauthenticated API routes", () => {
    expect(gateRequest("/api/chat", false)).toEqual({ type: "unauthorized" });
  });

  it("redirects unauthenticated HTML to sign-in", () => {
    expect(gateRequest("/dashboard", false)).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("redirects unauthenticated /home to sign-in", () => {
    expect(gateRequest("/home", false)).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("redirects unauthenticated /operator to sign-in", () => {
    expect(gateRequest("/operator", false)).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("allows widget API without a session", () => {
    expect(gateRequest("/api/widget/abc/chat", false)).toEqual({
      type: "next",
    });
  });
});

describe("gateRequest for client users", () => {
  it.each(["/home", "/chat", "/operator", "/settings/profile", "/agents/a1"])(
    "sends a client from %s to /client/reports",
    (pathname) => {
      expect(gateRequest(pathname, true, { isClient: true })).toEqual({
        type: "redirect",
        to: "/client/reports",
      });
    },
  );

  it("sends a client away from sign-in to the portal", () => {
    expect(gateRequest("/sign-in", true, { isClient: true })).toEqual({
      type: "redirect",
      to: "/client/reports",
    });
  });

  it.each([
    "/client/reports",
    "/client/reports/archive",
    "/client/live",
    "/h/tok_123",
    "/api/client/reports",
    "/api/auth/session",
  ])("lets a client through to %s", (pathname) => {
    expect(gateRequest(pathname, true, { isClient: true })).toEqual({
      type: "next",
    });
  });

  it("does not treat a /clientx prefix as the portal", () => {
    expect(gateRequest("/clientx", true, { isClient: true })).toEqual({
      type: "redirect",
      to: "/client/reports",
    });
  });

  it("lets owners and members open the portal preview", () => {
    expect(gateRequest("/client/reports", true)).toEqual({ type: "next" });
    expect(gateRequest("/client/live", true, { isClient: false })).toEqual({
      type: "next",
    });
  });

  it("still sends an unauthenticated portal visit to sign-in", () => {
    expect(gateRequest("/client/reports", false)).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });
});
