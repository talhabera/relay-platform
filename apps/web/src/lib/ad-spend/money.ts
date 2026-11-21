/**
 * TRY amounts as integer minor units (kuruş). Never a float: the text is
 * split into whole and fraction digits and combined with integer math.
 */

const CURRENCY_MARKS = /₺|\bTRY\b|\bTL\b/gi;
const WHITESPACE = /[\s  ]/g;

/** Whole part with optional thousands groups of one separator kind. */
function parseWhole(whole: string, groupSeparator: "." | "," | null): bigint | null {
  if (!/^\d[\d.,]*$/.test(whole)) return null;
  if (groupSeparator === null) return /^\d+$/.test(whole) ? BigInt(whole) : null;
  const groups = whole.split(groupSeparator);
  if (groups.length === 1) return /^\d+$/.test(whole) ? BigInt(whole) : null;
  const [first, ...rest] = groups;
  if (!/^\d{1,3}$/.test(first) || rest.some((g) => !/^\d{3}$/.test(g))) return null;
  return BigInt(groups.join(""));
}

/**
 * Parses "1.234,56", "1234.56", "1,234.56", "₺467,00" or "467 TL" into
 * kuruş. The last `,` or `.` followed by one or two digits is the decimal
 * mark; any other separator is a thousands mark. Returns null for empty,
 * negative or malformed text.
 */
export function parseTryToMinor(input: string): number | null {
  const text = input.replace(CURRENCY_MARKS, "").replace(WHITESPACE, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;

  const decimalMatch = /^(.*)([.,])(\d{1,2})$/.exec(text);
  let whole: bigint | null;
  let fraction = BigInt(0);

  if (decimalMatch) {
    const [, wholeText, decimalMark, fractionText] = decimalMatch;
    const groupSeparator = decimalMark === "," ? "." : ",";
    if (wholeText.includes(decimalMark)) return null;
    whole = parseWhole(wholeText, wholeText.includes(groupSeparator) ? groupSeparator : null);
    fraction = BigInt(fractionText.padEnd(2, "0"));
  } else {
    const hasDot = text.includes(".");
    const hasComma = text.includes(",");
    if (hasDot && hasComma) return null;
    whole = parseWhole(text, hasDot ? "." : hasComma ? "," : null);
  }

  if (whole === null) return null;
  const minor = whole * BigInt(100) + fraction;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** 123456 → "1.234,56 TL"; 46700 → "467 TL" (a zero fraction is dropped). */
export function minorToTryLabel(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = fraction === 0 ? grouped : `${grouped},${String(fraction).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${body} TL`;
}
