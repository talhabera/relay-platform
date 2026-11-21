import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../members/actions", () => ({ setMemberPageAccess: vi.fn() }));

import { AccessMatrix, type AccessMatrixPerson } from "./access-matrix";

const member: AccessMatrixPerson = {
  userId: "u-1",
  name: "Deniz Aksoy",
  email: "deniz@acme-gmbh.de",
  kind: "member",
  roleLabel: "Operator",
  pagePermissions: { operator: true, messaging: false, analytics: false, agents: false },
  approvesAny: true,
};

describe("AccessMatrix (W5GAP)", () => {
  it("mirrors approve rights with a disabled switch, not a focusable one", () => {
    const html = renderToStaticMarkup(h(AccessMatrix, { companyId: "c-1", people: [member] }));
    const tag = html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('aria-checked="true"');
    expect(tag).toMatch(/\sdisabled=""/);
    expect(html).not.toContain("[&amp;_[role=switch]]:pointer-events-none");
  });
});
