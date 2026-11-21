import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthCard, InAppError, InAppNotFound, NoCompanyState, PublicNotFound } from "./system-states";
import { SignInPanel } from "@/app/(auth)/sign-in/sign-in-card";
import { InviteOnlyCard } from "@/app/(auth)/sign-up/invite-only-card";
import { GlobalErrorCard } from "@/app/global-error-card";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const noop = async () => {};

// Figma 03 `1:4` Shell and Auth: auth card, sign-in x4, sign-up, not-found x2, error x2, no-company x2.
describe("Auth card (03/sign-in/* card)", () => {
  it("is a 480px glowing card with the brand lockup on top", () => {
    const html = render(h(AuthCard, { title: "Sign in to Relay", description: "Body" }));
    expect(html).toContain('data-slot="auth-card"');
    expect(html).toContain("max-w-120");
    expect(html).toContain("shadow-glow-primary");
    expect(html).toContain('data-slot="brand-lockup"');
    expect(html).toMatch(/<h1[^>]*>Sign in to Relay<\/h1>/);
  });
});

describe("Sign-in panel (03/sign-in/*)", () => {
  const base = { oidc: true, localDev: false, devUser: "operator", onNexAuth: noop, onDev: noop };

  it("default: closed-beta copy, Continue with NexAuth, access footnote", () => {
    const html = render(h(SignInPanel, { ...base, state: "default" }));
    expect(html).toContain("Relay is in closed beta. Sign in with your NexAuth account.");
    expect(html).toContain("Continue with NexAuth");
    expect(html).toContain('data-icon="key-round"');
    expect(html).toContain("Need access? Ask a company owner to add you by email.");
    expect(html).not.toContain('data-slot="sign-in-alert"');
  });

  it("redirect-pending: spinner, disabled soft button, keep-tab-open copy", () => {
    const html = render(h(SignInPanel, { ...base, state: "redirect-pending" }));
    expect(html).toContain("Redirecting to NexAuth. Keep this tab open.");
    expect(html).toContain("Redirecting to NexAuth…");
    expect(html).toContain('data-icon="loader-circle"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("provider-error: destructive alert and Try again with NexAuth", () => {
    const html = render(h(SignInPanel, { ...base, state: "provider-error" }));
    expect(html).toContain('data-slot="sign-in-alert"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("Sign-in was cancelled or failed. Try again.");
    expect(html).toContain("Try again with NexAuth");
  });

  it("dev-credentials: localhost divider, dev form and dev footnote", () => {
    const html = render(h(SignInPanel, { ...base, localDev: true, state: "default" }));
    expect(html).toContain("Localhost only");
    expect(html).toContain("Dev sign-in (localhost)");
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain("Dev sign-in appears only when AUTH_DEV_ENABLED is set on localhost.");
    expect(html).toContain("Continue with NexAuth");
  });

  it("no provider: explains the missing configuration, no buttons", () => {
    const html = render(h(SignInPanel, { ...base, oidc: false, state: "default" }));
    expect(html).toContain("No sign-in provider is configured");
    expect(html).not.toContain("Continue with NexAuth");
  });
});

describe("Sign-up invite-only (03/sign-up/invite-only)", () => {
  it("renders Invite only, Go to sign in and the footnote", () => {
    const html = render(h(InviteOnlyCard));
    expect(html).toMatch(/<h1[^>]*>Invite only<\/h1>/);
    expect(html).toContain("Relay accounts are created by invitation.");
    expect(html).toMatch(/href="\/sign-in"[^>]*>Go to sign in/);
    expect(html).toContain("Already invited? Sign in with the email the owner added.");
  });
});

describe("Not found (03/not-found/*)", () => {
  it("public: 404 code, Home and Sign in actions inside the auth card", () => {
    const html = render(h(PublicNotFound));
    expect(html).toContain('data-slot="auth-card"');
    expect(html).toContain(">404<");
    expect(html).toContain("This page is not here");
    expect(html).toMatch(/href="\/"[^>]*>Home/);
    expect(html).toMatch(/href="\/sign-in"[^>]*>Sign in/);
  });

  it("in-app: link icon, Go to Home and Go back", () => {
    const html = render(h(InAppNotFound));
    expect(html).toContain('data-slot="in-app-not-found"');
    expect(html).toContain("The link may be old, or the page moved.");
    expect(html).toMatch(/href="\/home"[^>]*>.*Go to Home/);
    expect(html).toContain("Go back");
  });
});

describe("Error (03/error/*)", () => {
  it("in-app: alert icon tile, error id, Try again and Go to Home", () => {
    const html = render(h(InAppError, { digest: "3f9c2a71", onRetry: () => {} }));
    expect(html).toContain('data-icon="circle-alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain("An unexpected error occurred. Please try again.");
    expect(html).toContain("Error ID: 3f9c2a71");
    expect(html).toContain("Try again");
    expect(html).toMatch(/href="\/home"[^>]*>Go to Home/);
  });

  it("in-app: hides the error id without a digest", () => {
    expect(render(h(InAppError, { onRetry: () => {} }))).not.toContain("Error ID");
  });

  it("global: not responding card with Reload", () => {
    const html = render(h(GlobalErrorCard, { onReload: () => {} }));
    expect(html).toContain("Relay is not responding");
    expect(html).toContain("We could not load the app. Check your connection and try again.");
    expect(html).toContain('data-icon="refresh-cw"');
    expect(html).toContain("Reload");
  });
});

describe("No company (03/no-company/*)", () => {
  it("owner: No company selected with Go to Settings", () => {
    const html = render(h(NoCompanyState, { isOwner: true }));
    expect(html).toContain('data-icon="building-2"');
    expect(html).toContain("No company selected");
    expect(html).toContain("Pick a company to work in, or create one in Settings → Companies.");
    expect(html).toContain("Go to Settings");
  });

  it("member: No company yet, no action", () => {
    const html = render(h(NoCompanyState, { isOwner: false }));
    expect(html).toContain("No company yet");
    expect(html).toContain("Ask a company owner to add you to a company, then reload this page.");
    expect(html).not.toContain("Go to Settings");
  });
});
