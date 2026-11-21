/** Fixed and ordered: RELAY-19 (billing) reads these columns. */
export const CSV_COLUMNS = [
  "kod",
  "tip",
  "m2",
  "lokasyon",
  "butce",
  "iletisim",
  "skor",
  "status",
  "channelType",
  "createdAt",
] as const;

type CsvValue = string | number | Date | null;
type CsvRow = Record<(typeof CSV_COLUMNS)[number], CsvValue>;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Lead text comes from a stranger's chat. A cell starting with = + - @ would
 * run as a formula when the owner opens the file, so it gets a leading `'`.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return String(value);

  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM first so Excel does not mangle Turkish characters. */
export function leadsToCsv(rows: readonly CsvRow[]): string {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => escapeCsvCell(row[column])).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
