import { createElement as h, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix portals render nothing on the server; pass children through so the content
// renders into static markup.
vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  const Passthrough = ({ children }: { children?: ReactNode }) => h(Fragment, null, children);
  return { ...actual, Dialog: { ...actual.Dialog, Portal: Passthrough } };
});

vi.mock("@/app/(marketing)/actions", () => ({ requestAccess: vi.fn() }));

import type { RequestAccessResult } from "@/app/(marketing)/actions";
import { Dialog } from "@/components/ui/dialog";

import { RequestAccessDialog, RequestAccessDialogView, type RequestAccessDialogViewProps } from "./request-access-dialog";

const view = (props: Partial<RequestAccessDialogViewProps> = {}) =>
  renderToStaticMarkup(
    h(
      Dialog,
      { open: true },
      h(RequestAccessDialogView, {
        plan: "none",
        result: null,
        pending: false,
        clientCount: undefined,
        onClientCountChange: () => {},
        onSubmit: () => {},
        onDone: () => {},
        ...props,
      }),
    ),
  );

const failed: RequestAccessResult = { ok: false, error: "failed" };
const limited: RequestAccessResult = { ok: false, error: "rate_limited", retryAfterSec: 3600 };

describe("Request access dialog (Figma 09 request-access/*)", () => {
  it("keeps the placeholder's export and props", () => {
    const html = renderToStaticMarkup(
      h(RequestAccessDialog, { open: true, onOpenChange: () => {}, plan: "pro" }),
    );
    expect(html).toContain('data-slot="request-access-dialog"');
    expect(html).toContain('data-plan="pro"');
  });

  it("default: title, closed-beta copy, five fields, hidden plan + honeypot, stacked footer", () => {
    const html = view();
    expect(html).toContain('data-state-name="default"');
    expect(html).toContain(">Request access</h2>");
    expect(html).toContain("Relay is in closed beta. Tell us about your agency and we will reply by email.");
    for (const label of ["Name", "Work email", "Agency name", "Clients you manage", "Message (optional)"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    for (const placeholder of ["Ada Lovelace", "you@agency.com", "Northwind Studio", "Anything we should know about your clients or channels?"]) {
      expect(html).toContain(`placeholder="${placeholder}"`);
    }
    expect(html).toContain('name="plan" value="none"');
    expect(html).toMatch(/<input type="text" tabindex="-1"[^>]*class="hidden" name="website"\/>/);
    // Client count is a Segmented control (en dash labels, spec values), nothing picked yet.
    expect(html).toContain('data-slot="segmented"');
    expect(html).toContain(">2–5<");
    expect(html).toContain(">6–20<");
    expect(html).toContain('name="clientCount" value=""');
    expect(html).toContain('data-slot="dialog-close"');
    expect(html).toContain('data-layout="stacked"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Request access<\/button>/);
    expect(html).toContain("By requesting access you agree to our");
    expect(html).toMatch(/href="\/privacy"[^>]*>Privacy policy<\/a>/);
    expect(html).not.toContain('role="alert"');
  });

  it("talk-to-sales: enterprise preset changes title, description and submit, not fields", () => {
    const html = view({ plan: "enterprise" });
    expect(html).toContain('data-state-name="talk-to-sales"');
    expect(html).toContain(">Talk to sales</h2>");
    expect(html).toContain("Tell us about your agency and what you need from Enterprise. We will reply by email.");
    expect(html).toMatch(/type="submit"[^>]*>Talk to sales<\/button>/);
    expect(html).toContain('name="plan" value="enterprise"');
    expect(html).toContain(">Agency name</label>");
  });

  it("submitting: fields disabled, Sending…", () => {
    const html = view({ pending: true, clientCount: "6-20" });
    expect(html).toContain('data-state-name="submitting"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Sending…<\/button>/);
    expect(html).toMatch(/id="ra-name"[^>]*disabled=""/);
    expect(html).toContain('name="clientCount" value="6-20"');
  });

  it("error: error banner and Try again", () => {
    const html = view({ result: failed });
    expect(html).toContain('data-state-name="error"');
    expect(html).toContain('data-tone="error"');
    expect(html).toContain("bg-status-rejected");
    expect(html).toContain("We could not send your request. Nothing was lost; try again in a moment.");
    expect(html).toMatch(/type="submit"[^>]*>Try again<\/button>/);
  });

  it("rate-limited: warning banner, submit disabled", () => {
    const html = view({ result: limited });
    expect(html).toContain('data-state-name="rate-limited"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain("bg-status-pending");
    expect(html).toContain("Too many requests from this network. Try again in an hour.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Request access<\/button>/);
  });

  it("field errors mark the inputs invalid and show the server message", () => {
    const html = view({ result: { ok: false, error: "invalid", fieldErrors: { email: "Enter a valid work email" } } });
    expect(html).toMatch(/id="ra-email"[^>]*aria-invalid="true"/);
    expect(html).toContain("Enter a valid work email");
  });

  it("success: Request received with a success icon, inline Done", () => {
    const html = view({ result: { ok: true, name: "Ada", email: "ada@northwind.studio" } });
    expect(html).toContain('data-state-name="success"');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain("Request received");
    expect(html).toContain(
      "Thanks, Ada. We review every request by hand and will email ada@northwind.studio when your workspace is ready.",
    );
    expect(html).toContain('data-layout="inline"');
    expect(html).toMatch(/<button[^>]*>Done<\/button>/);
    expect(html).not.toContain("<form");
  });
});
