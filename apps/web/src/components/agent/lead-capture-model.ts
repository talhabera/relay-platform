import type { WorkflowIntakeField } from "@relay/db";

// Pure helpers for the customer inspector Lead capture section and its intake
// editor (Figma 07 `agents-customer/lead-capture-{on, off, editing-intake}`).

export type { LeadCaptureWorkflowOption, LeadCapturePanelData } from "@/lib/leads/lead-capture";

/** Intake card title: "Intake · Lead engine", or "Intake · Default" without a workflow. */
export function intakeTitle(workflowName: string | null | undefined): string {
  return `Intake · ${workflowName ?? "Default"}`;
}

/** Intake card meta: "6 fields, 3 required: name, company, need". */
export function intakeSummary(intake: readonly WorkflowIntakeField[]): string {
  const fields = `${intake.length} ${intake.length === 1 ? "field" : "fields"}`;
  const required = intake.filter((f) => f.required);
  if (required.length === 0) return `${fields}, none required`;
  return `${fields}, ${required.length} required: ${required.map((f) => f.label.toLowerCase()).join(", ")}`;
}

/** Intake editor subtitle: "Lead engine workflow · shared by 2 customer agents". */
export function intakeEditorSubtitle(workflowName: string, sharedBy: number): string {
  const n = Math.max(sharedBy, 1);
  return `${workflowName} workflow · shared by ${n} customer ${n === 1 ? "agent" : "agents"}`;
}

// ── Intake editor draft ───────────────────────────────────────────────────────

/** One editable row. `key` is kept for existing fields so stored answers stay put. */
export type IntakeDraftField = {
  /** Stable row id for React keys. */
  id: string;
  key: string | null;
  label: string;
  required: boolean;
};

export function toIntakeDraft(intake: readonly WorkflowIntakeField[]): IntakeDraftField[] {
  return intake.map((f) => ({ id: `k:${f.key}`, key: f.key, label: f.label, required: f.required }));
}

/** Move the row at `from` to `to` (both clamped); a no-op returns the same array. */
export function moveIntakeField<T>(list: readonly T[], from: number, to: number): T[] {
  const last = list.length - 1;
  const src = Math.min(Math.max(from, 0), last);
  const dst = Math.min(Math.max(to, 0), last);
  if (src === dst || list.length < 2) return [...list];
  const next = [...list];
  const [item] = next.splice(src, 1);
  next.splice(dst, 0, item);
  return next;
}

export const INTAKE_FIELDS_MAX = 20;
export const INTAKE_LABEL_MAX = 60;

/** Filled outside the checklist (phone from the channel, kod, the reject control). */
const RESERVED_KEYS = new Set(["phone", "kod", "rejected"]);
const KEY_MAX = 40;

const TURKISH: Record<string, string> = { ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g", ç: "c", Ç: "c", ö: "o", Ö: "o", ü: "u", Ü: "u" };

/** A tool-input key for a new field: lowercase ascii snake case, unique, never reserved. */
export function intakeKeyFromLabel(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TURKISH[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  base = base.slice(0, KEY_MAX).replace(/_+$/, "");
  let key = base;
  for (let n = 2; taken.has(key) || RESERVED_KEYS.has(key); n++) {
    const suffix = `_${n}`;
    key = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
  }
  return key;
}

export type IntakeDraftResult =
  | { ok: true; fields: WorkflowIntakeField[] }
  | { ok: false; error: string };

/** Validate the editor rows and turn them into the stored intake, in order. */
export function intakeFromDraft(draft: readonly IntakeDraftField[]): IntakeDraftResult {
  if (draft.length === 0) return { ok: false, error: "Keep at least one field." };
  if (draft.length > INTAKE_FIELDS_MAX) return { ok: false, error: `Use ${INTAKE_FIELDS_MAX} fields or fewer.` };
  const labels = draft.map((f) => f.label.trim());
  if (labels.some((l) => l === "")) return { ok: false, error: "Every field needs a name." };
  if (labels.some((l) => l.length > INTAKE_LABEL_MAX)) {
    return { ok: false, error: `Keep field names under ${INTAKE_LABEL_MAX} characters.` };
  }
  const lower = labels.map((l) => l.toLowerCase());
  if (new Set(lower).size !== lower.length) return { ok: false, error: "Two fields have the same name." };
  if (lower.includes("phone")) return { ok: false, error: "Phone comes from the channel; it is never asked." };

  const taken = new Set(draft.flatMap((f) => (f.key ? [f.key] : [])));
  const fields = draft.map((f, i) => {
    let key = f.key;
    if (!key) {
      key = intakeKeyFromLabel(labels[i], taken);
      taken.add(key);
    }
    return { key, label: labels[i], required: f.required };
  });
  return { ok: true, fields };
}
