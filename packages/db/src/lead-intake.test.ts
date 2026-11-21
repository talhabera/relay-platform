import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEAD_ENGINE_INTAKE,
  LEGACY_INBOUND_INTAKE,
  effectiveIntake,
  isIntakeComplete,
  missingIntakeFields,
  toE164,
} from "./lead-intake";

describe("effectiveIntake", () => {
  it("falls back to the legacy checklist when the workflow has none", () => {
    expect(effectiveIntake(null)).toEqual(LEGACY_INBOUND_INTAKE);
    expect(effectiveIntake([])).toEqual(LEGACY_INBOUND_INTAKE);
  });

  it("keeps the workflow order and drops phone, kod, bad and repeated keys", () => {
    const intake = effectiveIntake([
      { key: "need", label: "Need", required: true },
      { key: "phone", label: "Phone", required: true },
      { key: "kod", label: "Code", required: false },
      { key: "Bad Key", label: "x", required: true },
      { key: "need", label: "Again", required: false },
      { key: "budget", label: "", required: false },
    ]);
    expect(intake).toEqual([
      { key: "need", label: "Need", required: true },
      { key: "budget", label: "budget", required: false },
    ]);
  });

  it("seeds the Lead engine with name, company, need, budget, timeline, location", () => {
    expect(LEAD_ENGINE_INTAKE.map((f) => f.key)).toEqual([
      "name",
      "company",
      "need",
      "budget",
      "timeline",
      "location",
    ]);
  });
});

describe("intake completeness", () => {
  const intake = [
    { key: "need", label: "Need", required: true },
    { key: "budget", label: "Budget", required: true },
    { key: "company", label: "Company", required: false },
  ];

  it("lists the empty required fields by label", () => {
    expect(missingIntakeFields(intake, { need: "kitchen", budget: "  " })).toEqual([
      "Budget",
    ]);
  });

  it("is complete when every required field is filled", () => {
    expect(isIntakeComplete(intake, { need: "kitchen", budget: "5k" })).toBe(true);
    expect(isIntakeComplete(intake, { need: "kitchen" })).toBe(false);
  });
});

describe("toE164", () => {
  it("turns a WhatsApp wa_id into E.164", () => {
    expect(toE164("905321234567")).toBe("+905321234567");
    expect(toE164("+905321234567")).toBe("+905321234567");
  });

  it("refuses anything that is not a phone number", () => {
    expect(toE164(null)).toBeNull();
    expect(toE164("visitor-abc")).toBeNull();
    expect(toE164("0123456789")).toBeNull();
    expect(toE164("12345")).toBeNull();
  });
});

describe("0033_lead_capture.sql", () => {
  const dir = path.join(__dirname, "../drizzle");
  const sql = readFileSync(path.join(dir, "0033_lead_capture.sql"), "utf8");

  it("turns Lead capture on once, for customer agents only", () => {
    expect(sql).toContain(`column_name = 'lead_capture_enabled'`);
    expect(sql).toContain(
      `UPDATE "agents" SET "lead_capture_enabled" = true WHERE "kind" = 'customer'`,
    );
  });

  it("re-runs the leads backfill, idempotent by id", () => {
    expect(sql).toContain(`FROM "leads" l`);
    expect(sql).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "company_records" r WHERE r."id" = l."id")`);
    expect(sql).toContain(`WHEN 'qualified' THEN 'qualified'`);
  });

  it("has a down file", () => {
    expect(readdirSync(path.join(dir, "down"))).toContain("0033_lead_capture.sql");
  });
});
