import { describe, expect, it } from "vitest";
import { LEAD_ENGINE_INTAKE } from "@relay/db";

import {
  intakeEditorSubtitle,
  intakeFromDraft,
  intakeKeyFromLabel,
  intakeSummary,
  intakeTitle,
  moveIntakeField,
  toIntakeDraft,
} from "./lead-capture-model";

const FIGMA_INTAKE = [
  { key: "name", label: "Name", required: true },
  { key: "company", label: "Company", required: true },
  { key: "need", label: "Need", required: true },
  { key: "budget", label: "Budget", required: false },
  { key: "timeline", label: "Timeline", required: false },
  { key: "location", label: "Location", required: false },
];

describe("lead capture copy (Figma 07 lead-capture-on)", () => {
  it("summarises the intake card", () => {
    expect(intakeTitle("Lead engine")).toBe("Intake · Lead engine");
    expect(intakeTitle(null)).toBe("Intake · Default");
    expect(intakeSummary(FIGMA_INTAKE)).toBe("6 fields, 3 required: name, company, need");
    expect(intakeSummary([{ key: "need", label: "Need", required: false }])).toBe("1 field, none required");
  });

  it("names the workflow and how many agents share it", () => {
    expect(intakeEditorSubtitle("Lead engine", 2)).toBe("Lead engine workflow · shared by 2 customer agents");
    expect(intakeEditorSubtitle("Lead engine", 0)).toBe("Lead engine workflow · shared by 1 customer agent");
  });
});

describe("intake draft", () => {
  it("reorders rows and clamps out-of-range moves", () => {
    expect(moveIntakeField(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveIntakeField(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveIntakeField(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveIntakeField(["a", "b", "c"], 2, 3)).toEqual(["a", "b", "c"]);
  });

  it("round-trips an unchanged intake with its keys", () => {
    expect(intakeFromDraft(toIntakeDraft(LEAD_ENGINE_INTAKE))).toEqual({ ok: true, fields: LEAD_ENGINE_INTAKE });
  });

  it("keeps the key of a renamed field so stored answers stay put", () => {
    const draft = toIntakeDraft(FIGMA_INTAKE).map((f) => (f.key === "need" ? { ...f, label: " What they need " } : f));
    const result = intakeFromDraft(draft);
    expect(result.ok && result.fields[2]).toEqual({ key: "need", label: "What they need", required: true });
  });

  it("gives new fields a unique snake_case key", () => {
    const draft = [
      ...toIntakeDraft([{ key: "budget", label: "Budget", required: true }]),
      { id: "new:1", key: null, label: "Bütçe aralığı", required: false },
      { id: "new:2", key: null, label: "budget!", required: true },
    ];
    const result = intakeFromDraft(draft);
    expect(result.ok && result.fields.map((f) => f.key)).toEqual(["budget", "butce_araligi", "budget_2"]);
  });

  it("never mints a reserved or invalid key", () => {
    expect(intakeKeyFromLabel("Kod", new Set())).toBe("kod_2");
    expect(intakeKeyFromLabel("2nd contact", new Set())).toBe("f_2nd_contact");
    expect(intakeKeyFromLabel("???", new Set())).toBe("field");
    expect(intakeKeyFromLabel("x".repeat(80), new Set())).toHaveLength(40);
  });

  it("rejects empty, duplicate and phone fields", () => {
    const base = toIntakeDraft(FIGMA_INTAKE);
    expect(intakeFromDraft([])).toEqual({ ok: false, error: "Keep at least one field." });
    expect(intakeFromDraft([...base, { id: "n", key: null, label: "  ", required: false }])).toMatchObject({ ok: false });
    expect(intakeFromDraft([...base, { id: "n", key: null, label: "name", required: false }])).toEqual({
      ok: false,
      error: "Two fields have the same name.",
    });
    expect(intakeFromDraft([...base, { id: "n", key: null, label: "Phone", required: false }])).toMatchObject({
      ok: false,
    });
  });
});
