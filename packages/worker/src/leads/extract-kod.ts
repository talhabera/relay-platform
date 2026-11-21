import { KOD_PATTERN } from "../ai/lead-line";

const LABELED_KOD_PATTERN = /\bkod\s*[:=]\s*([A-Z0-9]{5})(?![A-Z0-9])/i;
const BARE_TOKEN_PATTERN = /\b[A-Z0-9]{5}\b/gi;
// Channel letters for issued bare codes: G (Google), M (Meta), R (Instagram retargeting).
// I is never issued: it reads like 1.
const BARE_PREFIXES = new Set(["G", "M", "R"]);

/**
 * Read the 5-character campaign code a person pastes in their first message,
 * e.g. "Merhaba, web sitesi için yazıyorum. (Kod: G7KF3)". The labeled form
 * wins; a bare token only counts with a channel letter and a digit, so
 * ordinary 5-letter words do not leak in. Returns null when there is no code.
 */
export function extractKod(text: string): string | null {
  const labeled = text.match(LABELED_KOD_PATTERN);
  if (labeled) {
    const kod = labeled[1].toUpperCase();
    if (KOD_PATTERN.test(kod)) return kod;
  }

  for (const match of text.matchAll(BARE_TOKEN_PATTERN)) {
    const kod = match[0].toUpperCase();
    if (!BARE_PREFIXES.has(kod[0])) continue;
    if (!/\d/.test(kod)) continue;
    if (KOD_PATTERN.test(kod)) return kod;
  }
  return null;
}
