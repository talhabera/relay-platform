import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/agents/actions", () => ({ createAgentFromDialog: vi.fn() }));
vi.mock("@/app/(dashboard)/operator/actions", () => ({ createOperatorAgentFromDialog: vi.fn() }));

import { CreateOperatorAgentDialog } from "@/components/operator/create-operator-agent-dialog";
import { createCustomerAgentDialogSchema } from "@/lib/validators/agent";
import { createOperatorAgentDialogSchema } from "@/lib/validators/operator";

import {
  CUSTOMER_STARTS,
  OPERATOR_ROSTER,
  customerStartInstructions,
  modelLabel,
  operatorRole,
} from "./agent-templates";
import { CreateAgentDialog } from "./create-agent-dialog";

const companyId = "6f1c1f9e-2a7b-4c1e-9f55-0a4c3b2d1e0f";

describe("create-agent templates", () => {
  it("offers the three customer starts from Figma, blank last and empty", () => {
    expect(CUSTOMER_STARTS.map((s) => s.label)).toEqual([
      "Quote requests and site visits",
      "Customer support and FAQs",
      "Blank agent",
    ]);
    expect(customerStartInstructions("blank")).toBe("");
    expect(customerStartInstructions("quotes")).toMatch(/quote/i);
  });

  it("lists the five operator roles with their default models", () => {
    expect(OPERATOR_ROSTER.map((r) => `${r.name} ${modelLabel(r.model)}`)).toEqual([
      "Lead Gatherer Claude Haiku",
      "Lead Qualifier Claude Sonnet",
      "Mail Marketer Claude Sonnet",
      "Social Media Manager Claude Sonnet",
      "Market Analyst Claude Opus",
    ]);
    expect(operatorRole("social-media-manager")?.description).toBe(
      "Plans, drafts and schedules posts for Instagram, Facebook and LinkedIn.",
    );
    expect(operatorRole("nope")).toBeUndefined();
  });
});

describe("create-agent validation", () => {
  it("asks for a name (Figma error state)", () => {
    const r = createCustomerAgentDialogSchema.safeParse({ companyId, name: "  ", model: "sonnet", start: "quotes" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Enter a name for the agent.");
  });

  it("accepts a customer agent and trims the name", () => {
    const r = createCustomerAgentDialogSchema.parse({ companyId, name: " Acme ", model: "haiku", start: "blank" });
    expect(r.name).toBe("Acme");
  });

  it("accepts a blank or pre-defined operator agent and rejects unknown roles", () => {
    expect(
      createOperatorAgentDialogSchema.safeParse({ companyId, name: "X", model: "opus", role: null }).success,
    ).toBe(true);
    expect(
      createOperatorAgentDialogSchema.safeParse({ companyId, name: "X", model: "opus", role: "mail-marketer" }).success,
    ).toBe(true);
    expect(createOperatorAgentDialogSchema.safeParse({ companyId, name: "X", model: "opus", role: "ceo" }).success).toBe(
      false,
    );
  });
});

describe("create-agent triggers", () => {
  it("labels the two entry points by kind", () => {
    expect(renderToStaticMarkup(h(CreateAgentDialog, { companyId }))).toContain("Create customer agent");
    expect(renderToStaticMarkup(h(CreateOperatorAgentDialog, { companyId }))).toContain("Create operator agent");
  });
});
