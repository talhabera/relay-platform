import type { WorkflowIntakeField } from "./schema/workflows";

// Inbound intake (lead scoring spec, decisions 9-13). The intake is the
// ordered field list a customer agent collects before a lead is scored; it
// lives on the workflow the agent's Lead capture feeds. Phone is never on the
// list: it comes from the channel.

/** The Lead engine catalog seed (decision 10). */
export const LEAD_ENGINE_INTAKE: readonly WorkflowIntakeField[] = [
  { key: "name", label: "Name", required: true },
  { key: "company", label: "Company", required: false },
  { key: "need", label: "Need", required: true },
  { key: "budget", label: "Budget", required: true },
  { key: "timeline", label: "Timeline", required: true },
  { key: "location", label: "Location", required: false },
];

/**
 * The #18 `captureLead` field set (the pilot client's intake). Used when Lead capture is
 * on but no workflow is picked, which is the state migration 0033 leaves every
 * existing customer agent in, so their checklist does not change under them.
 */
export const LEGACY_INBOUND_INTAKE: readonly WorkflowIntakeField[] = [
  { key: "tip", label: "Proje tipi", required: true },
  { key: "m2", label: "Metrekare", required: true },
  { key: "lokasyon", label: "Lokasyon", required: true },
  { key: "butce", label: "Bütçe", required: true },
  { key: "iletisim", label: "İletişim", required: true },
];

/**
 * The manual campaign code from the first message (decision 14). Not an
 * intake field: it is attribution, so it is offered on every intake.
 */
export const LEAD_KOD_KEY = "kod";

const INTAKE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Filled outside the checklist (`phone`, `kod`) or a tool control (`rejected`). */
const RESERVED_KEYS = new Set(["phone", LEAD_KOD_KEY, "rejected"]);

/**
 * The workflow's intake, cleaned for use as tool input keys: valid keys only,
 * first occurrence wins, reserved keys dropped. Falls back to the legacy list when nothing usable is left.
 */
export function effectiveIntake(
  intake: readonly WorkflowIntakeField[] | null | undefined,
): WorkflowIntakeField[] {
  const seen = new Set<string>();
  const fields: WorkflowIntakeField[] = [];
  for (const field of intake ?? []) {
    if (!field || typeof field.key !== "string") continue;
    if (!INTAKE_KEY.test(field.key)) continue;
    if (RESERVED_KEYS.has(field.key)) continue;
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    fields.push({
      key: field.key,
      label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.key,
      required: field.required === true,
    });
  }
  return fields.length > 0 ? fields : LEGACY_INBOUND_INTAKE.map((f) => ({ ...f }));
}

function filled(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  return value !== null && value !== undefined;
}

/** Labels of the required fields still empty in `answers`, in intake order. */
export function missingIntakeFields(
  intake: readonly WorkflowIntakeField[],
  answers: Record<string, unknown>,
): string[] {
  return intake
    .filter((field) => field.required && !filled(answers[field.key]))
    .map((field) => field.label);
}

/** Decision 11: every required field is filled. */
export function isIntakeComplete(
  intake: readonly WorkflowIntakeField[],
  answers: Record<string, unknown>,
): boolean {
  return missingIntakeFields(intake, answers).length === 0;
}

/**
 * E.164 from a channel sender id (decision 13). WhatsApp's `wa_id` is the
 * number in digits without the plus. Anything that is not 8-15 digits (after
 * an optional plus) is not a phone number and yields null.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.trim().replace(/^\+/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
