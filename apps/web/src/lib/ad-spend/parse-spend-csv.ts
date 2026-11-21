import type { AdChannel } from "@relay/db";

import { parseTryToMinor } from "./money";

/**
 * Google Ads / Meta spend CSV → spend rows. The real export formats are not
 * verified (koleva-web `docs/reklam/arastirma/R3.md` section 3), so the parser
 * trusts nothing: an unknown header set, a non-TRY currency, an unreadable
 * date or amount, or too many rows rejects the whole file with a Turkish
 * reason and no rows. Cell text is kept as plain text and never evaluated.
 */

export const MAX_SPEND_CSV_ROWS = 5000;
/** Upload size limit for one spend CSV. */
export const MAX_SPEND_CSV_BYTES = 2 * 1024 * 1024;

export type SpendPlatform = "google" | "meta";

export type ParsedSpendRow = {
  date: string;
  channel: AdChannel;
  campaignId?: string;
  campaignName?: string;
  amountMinor: number;
  impressions?: number;
  clicks?: number;
};

export type ParseSpendCsvResult =
  | {
      ok: true;
      platform: SpendPlatform;
      rows: ParsedSpendRow[];
      /** Rows dropped because a later row in the file had the same key. */
      duplicates: number;
      /** Summary or total rows skipped (empty date cell or "Total"). */
      skippedSummary: number;
    }
  | { ok: false; reason: string };

export type ParseSpendCsvOptions = {
  /**
   * Meta campaign names that belong to the Instagram retargeting channel
   * (from the RL4 Meta mapping). Any other Meta campaign maps to `meta`.
   */
  instagramCampaignNames?: Iterable<string>;
};

type Field = "date" | "campaignId" | "campaignName" | "amount" | "impressions" | "clicks" | "currency";

/**
 * Accepted header names per platform, compared after `normalizeHeader`.
 * `amount` decides the platform, so its names must not overlap.
 */
const HEADER_TABLE: Record<SpendPlatform, Record<Field, readonly string[]>> = {
  google: {
    // UNVERIFIED: confirm against a real export sample
    date: ["day", "date", "gün", "tarih"],
    // UNVERIFIED: confirm against a real export sample
    campaignId: ["campaign id", "kampanya kimliği"],
    // UNVERIFIED: confirm against a real export sample
    campaignName: ["campaign", "kampanya"],
    // UNVERIFIED: confirm against a real export sample
    amount: ["cost", "maliyet"],
    // UNVERIFIED: confirm against a real export sample
    impressions: ["impr.", "impressions", "gösterim", "gösterimler", "gösterim sayısı"],
    // UNVERIFIED: confirm against a real export sample
    clicks: ["clicks", "tıklamalar", "tıklama"],
    // UNVERIFIED: confirm against a real export sample
    currency: ["currency code", "currency", "para birimi kodu", "para birimi"],
  },
  meta: {
    // UNVERIFIED: confirm against a real export sample
    date: ["day", "date", "reporting starts", "gün", "tarih", "raporlama başlangıcı"],
    // UNVERIFIED: confirm against a real export sample
    campaignId: ["campaign id", "kampanya kimliği"],
    // UNVERIFIED: confirm against a real export sample
    campaignName: ["campaign name", "kampanya adı", "kampanya ismi"],
    // UNVERIFIED: confirm against a real export sample
    amount: ["amount spent", "harcanan tutar"],
    // UNVERIFIED: confirm against a real export sample
    impressions: ["impressions", "gösterimler", "gösterim"],
    // UNVERIFIED: confirm against a real export sample
    clicks: ["link clicks", "clicks", "bağlantı tıklamaları", "tıklamalar"],
    // UNVERIFIED: confirm against a real export sample
    currency: ["currency", "para birimi"],
  },
};

const TRY_MARKS = new Set(["try", "tl", "₺"]);
const DELIMITERS = [",", ";", "\t"] as const;
const HEADER_SCAN_ROWS = 10;

type NormalizedHeader = { name: string; currency: string | null };

/** Case-insensitive, trimmed, trailing "(TRY)" style parenthesis split off. */
function normalizeHeader(raw: string): NormalizedHeader {
  const lowered = raw.replace(/İ/g, "i").normalize("NFC").toLowerCase().trim();
  const paren = /^(.*?)\s*\(([^()]*)\)$/.exec(lowered);
  if (paren && paren[1]) return { name: paren[1].replace(/\s+/g, " "), currency: paren[2].trim() };
  return { name: lowered.replace(/\s+/g, " "), currency: null };
}

/** RFC 4180 records: quoted fields with `""` escapes, CRLF or LF line ends. */
export function readCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type HeaderMatch = {
  platform: SpendPlatform;
  headerRow: number;
  columns: Partial<Record<Field, number>>;
  headerCurrencies: (string | null)[];
};

function matchHeader(cells: string[]): Omit<HeaderMatch, "headerRow"> | null {
  const normalized = cells.map(normalizeHeader);
  for (const platform of ["meta", "google"] as const) {
    const table = HEADER_TABLE[platform];
    const columns: Partial<Record<Field, number>> = {};
    for (const field of Object.keys(table) as Field[]) {
      const index = normalized.findIndex((h) => table[field].includes(h.name));
      if (index >= 0) columns[field] = index;
    }
    if (columns.amount !== undefined && columns.date !== undefined) {
      return { platform, columns, headerCurrencies: normalized.map((h) => h.currency) };
    }
  }
  return null;
}

function findHeader(records: string[][]): HeaderMatch | null {
  for (let row = 0; row < Math.min(records.length, HEADER_SCAN_ROWS); row += 1) {
    const match = matchHeader(records[row]);
    if (match) return { ...match, headerRow: row };
  }
  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** `2026-11-04` or `04.11.2026` (also `4.11.2026`) → `2026-11-04`. */
export function parseSpendDate(raw: string): string | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dotted) {
    [day, month, year] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])];
  } else {
    return null;
  }
  if (!isRealDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Empty or "--" is no value; grouped digits are a count; anything else is invalid. */
function parseCount(raw: string | undefined): number | undefined | null {
  const text = (raw ?? "").replace(/[\s ]/g, "");
  if (text === "" || text === "--") return undefined;
  if (/^\d{1,3}([.,]\d{3})+$/.test(text) || /^\d+$/.test(text)) {
    const value = Number(text.replace(/[.,]/g, ""));
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

function isSummaryDate(raw: string): boolean {
  const text = raw.trim().toLocaleLowerCase("tr-TR");
  return text === "" || text.startsWith("total") || text.startsWith("toplam");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function reject(reason: string): ParseSpendCsvResult {
  return { ok: false, reason };
}

/** Parses a whole file; all or nothing. */
export function parseSpendCsv(input: string, options: ParseSpendCsvOptions = {}): ParseSpendCsvResult {
  const text = stripBom(input);
  if (text.trim() === "") return reject("Dosya boş.");

  let records: string[][] = [];
  let header: HeaderMatch | null = null;
  for (const delimiter of DELIMITERS) {
    const candidate = readCsvRecords(text, delimiter);
    const match = findHeader(candidate);
    if (match && (!header || candidate[match.headerRow].length > records[header.headerRow].length)) {
      records = candidate;
      header = match;
    }
  }
  if (!header) {
    return reject(
      "Başlıklar tanınmadı. Google Ads için 'Gün' ve 'Maliyet', Meta için 'Gün' ve 'Harcanan tutar (TRY)' sütunları bekleniyor.",
    );
  }

  const { platform, columns, headerCurrencies } = header;
  const amountCurrency = columns.amount === undefined ? null : headerCurrencies[columns.amount];
  if (amountCurrency !== null && !TRY_MARKS.has(amountCurrency)) {
    return reject(`Para birimi TRY değil (${amountCurrency.toUpperCase()}). Yalnızca TRY dosyaları yüklenebilir.`);
  }

  const instagramNames = new Set(
    [...(options.instagramCampaignNames ?? [])].map((n) => n.trim().toLocaleLowerCase("tr-TR")),
  );
  const byKey = new Map<string, ParsedSpendRow>();
  let dataRows = 0;
  let duplicates = 0;
  let skippedSummary = 0;

  const dataRecords = records.slice(header.headerRow + 1);
  for (let index = 0; index < dataRecords.length; index += 1) {
    const cells = dataRecords[index];
    const line = header.headerRow + index + 2;
    const cell = (field: Field) => (columns[field] === undefined ? undefined : (cells[columns[field]] ?? "").trim());

    const rawDate = cell("date") ?? "";
    if (isSummaryDate(rawDate)) {
      skippedSummary += 1;
      continue;
    }
    dataRows += 1;
    if (dataRows > MAX_SPEND_CSV_ROWS) {
      return reject(`Dosyada ${MAX_SPEND_CSV_ROWS.toLocaleString("tr-TR")} satırdan fazla veri var. Daha kısa bir tarih aralığı seçin.`);
    }

    const date = parseSpendDate(rawDate);
    if (!date) return reject(`Satır ${line}: tarih okunamadı ("${rawDate}"). Beklenen biçim YYYY-AA-GG veya GG.AA.YYYY.`);

    const rawCurrency = cell("currency");
    if (rawCurrency && !TRY_MARKS.has(rawCurrency.toLowerCase())) {
      return reject(`Satır ${line}: para birimi TRY değil (${rawCurrency}). Yalnızca TRY dosyaları yüklenebilir.`);
    }

    const rawAmount = cell("amount") ?? "";
    const amountMinor = parseTryToMinor(rawAmount);
    if (amountMinor === null) return reject(`Satır ${line}: tutar okunamadı ("${rawAmount}").`);

    const impressions = parseCount(cell("impressions"));
    const clicks = parseCount(cell("clicks"));
    if (impressions === null) return reject(`Satır ${line}: gösterim sayısı okunamadı.`);
    if (clicks === null) return reject(`Satır ${line}: tıklama sayısı okunamadı.`);

    const campaignName = cell("campaignName") || undefined;
    const campaignId = cell("campaignId") || campaignName || undefined;
    const channel: AdChannel =
      platform === "google"
        ? "google"
        : campaignName && instagramNames.has(campaignName.toLocaleLowerCase("tr-TR"))
          ? "instagram"
          : "meta";

    const key = `${date}|${channel}|${campaignId ?? ""}`;
    if (byKey.has(key)) {
      duplicates += 1;
      byKey.delete(key);
    }
    byKey.set(key, {
      date,
      channel,
      ...(campaignId !== undefined ? { campaignId } : {}),
      ...(campaignName !== undefined ? { campaignName } : {}),
      amountMinor,
      ...(impressions !== undefined ? { impressions } : {}),
      ...(clicks !== undefined ? { clicks } : {}),
    });
  }

  if (dataRows === 0) return reject("Dosyada harcama satırı yok.");
  return { ok: true, platform, rows: [...byKey.values()], duplicates, skippedSummary };
}
