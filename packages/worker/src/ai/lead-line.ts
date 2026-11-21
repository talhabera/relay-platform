export const REQUIRED_FIELDS = ["tip", "m2", "lokasyon", "butce", "iletisim"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

const ALL_FIELDS = [...REQUIRED_FIELDS, "skor", "kod"] as const;
type FieldKey = (typeof ALL_FIELDS)[number];

export const KOD_PATTERN = /^[A-Z0-9]{5}$/;
const KOD_ORGANIK = "organik";

const LEAD_LINE_PATTERN = /^LEAD\s+(.+)$/m;
const KEY_VALUE_PATTERN = /(\S+)=(\S+)/g;

export type LeadLineFields = Partial<Record<FieldKey, string>>;

export interface ParseLeadLineResult {
  /** Whether a "LEAD ..." line was found in the text at all. */
  matched: boolean;
  /** Raw key=value pairs recognized from the line. */
  fields: LeadLineFields;
  /** Which of the 5 billable fields are absent. */
  missingFields: RequiredField[];
  /** True only if all 5 fields, a well-formed kod, and a 1-10 skor are present. */
  valid: boolean;
}

export function isKodValid(kod: string | undefined): boolean {
  if (!kod) return false;
  return kod === KOD_ORGANIK || KOD_PATTERN.test(kod);
}

export function isSkorValid(skor: string | undefined): boolean {
  if (!skor || !/^\d+$/.test(skor)) return false;
  const value = Number(skor);
  return value >= 1 && value <= 10;
}

/**
 * Extracts the closing "LEAD tip=... m2=... lokasyon=... butce=... iletisim=... skor=... kod=..."
 * line from a customer conversation. 
 */
export function parseLeadLine(text: string): ParseLeadLineResult {
  const lineMatch = text.match(LEAD_LINE_PATTERN);
  if (!lineMatch) {
    return {
      matched: false,
      fields: {},
      missingFields: [...REQUIRED_FIELDS],
      valid: false,
    };
  }

  const fields: LeadLineFields = {};
  let match: RegExpExecArray | null;
  KEY_VALUE_PATTERN.lastIndex = 0;
  while ((match = KEY_VALUE_PATTERN.exec(lineMatch[1])) !== null) {
    const [, key, value] = match;
    if ((ALL_FIELDS as readonly string[]).includes(key)) {
      fields[key as FieldKey] = value;
    }
  }

  const missingFields = REQUIRED_FIELDS.filter((field) => !fields[field]);

  const valid =
    missingFields.length === 0 &&
    isKodValid(fields.kod) &&
    isSkorValid(fields.skor);

  return { matched: true, fields, missingFields, valid };
}
