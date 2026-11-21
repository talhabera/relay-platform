"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AD_CHANNELS } from "@relay/db";
import { requireSession } from "@/lib/auth-server";
import { parseTryToMinor } from "@/lib/ad-spend/money";
import {
  MAX_SPEND_CSV_BYTES,
  parseSpendCsv,
  parseSpendDate,
  type SpendPlatform,
} from "@/lib/ad-spend/parse-spend-csv";
import {
  listInstagramCampaignNames,
  upsertSpendRows,
  type SpendKey,
  type SpendWriteRow,
} from "@/lib/ad-spend/spend-queries";

import { resolveAnalyticsAccess } from "../_overview/analytics-access";

export type SpendActionError = {
  ok: false;
  error: "unauthorized" | "invalid" | "rejected";
  message: string;
};

export type SpendWriteReport = {
  written: number;
  overwritten: number;
  duplicates: number;
  skippedApi: number;
  apiConflicts: SpendKey[];
};

export type SpendCsvPreview = {
  platform: SpendPlatform;
  rows: number;
  from: string;
  to: string;
  totalMinor: number;
  duplicates: number;
  skippedSummary: number;
};

export type SaveDailySpendResult = ({ ok: true } & SpendWriteReport) | SpendActionError;

export type ImportSpendCsvResult =
  | { ok: true; dryRun: true; preview: SpendCsvPreview }
  | ({ ok: true; dryRun: false; preview: SpendCsvPreview } & SpendWriteReport)
  | SpendActionError;

const UNAUTHORIZED: SpendActionError = {
  ok: false,
  error: "unauthorized",
  message: "Bu şirketin harcama verisine erişiminiz yok.",
};

function invalid(message: string): SpendActionError {
  return { ok: false, error: "invalid", message };
}

/** The active company the user may see Analytics for; never a client value. */
async function authorizedCompanyId(): Promise<string | null> {
  const session = await requireSession();
  const access = await resolveAnalyticsAccess(session.user.id);
  return access.kind === "ok" ? access.company.id : null;
}

function revalidateSpend() {
  revalidatePath("/analytics/spend");
  revalidatePath("/home");
}

const saveDailySpendSchema = z.object({
  date: z.string().max(10),
  entries: z
    .array(z.object({ channel: z.enum(AD_CHANNELS), amount: z.string().max(32) }))
    .max(AD_CHANNELS.length),
  allowOverApi: z.boolean().optional(),
});

/**
 * Typed daily spend for one Istanbul date, one channel-total row per channel.
 * An empty amount writes nothing; a typed 0 is stored as 0.
 */
export async function saveDailySpend(input: {
  date: string;
  entries: { channel: string; amount: string }[];
  allowOverApi?: boolean;
}): Promise<SaveDailySpendResult> {
  const companyId = await authorizedCompanyId();
  if (!companyId) return UNAUTHORIZED;

  const parsed = saveDailySpendSchema.safeParse(input);
  if (!parsed.success) return invalid("Geçersiz giriş.");
  const date = parseSpendDate(parsed.data.date);
  if (!date || date !== parsed.data.date) return invalid("Tarih geçersiz.");

  const channels = new Set<string>();
  const rows: SpendWriteRow[] = [];
  for (const entry of parsed.data.entries) {
    if (channels.has(entry.channel)) return invalid("Bir kanal iki kez girildi.");
    channels.add(entry.channel);
    if (entry.amount.trim() === "") continue;
    const amountMinor = parseTryToMinor(entry.amount);
    if (amountMinor === null) return invalid(`Tutar okunamadı: "${entry.amount}". Örnek: 1.234,56`);
    rows.push({ date, channel: entry.channel, campaignId: "", amountMinor });
  }
  if (rows.length === 0) return invalid("Kaydedilecek tutar yok.");

  const result = await upsertSpendRows({
    companyId,
    rows,
    source: "manual",
    allowOverApi: parsed.data.allowOverApi === true,
  });
  revalidateSpend();
  return { ok: true, ...result, duplicates: 0 };
}

/** UTF-8 first; replacement characters mean it was not UTF-8, so try Turkish Windows. */
function decodeCsv(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1254").decode(buffer);
}

function isFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && typeof value.arrayBuffer === "function";
}

/**
 * Google Ads / Meta CSV upload. `dryRun=1` returns the preview and writes
 * nothing; otherwise the parsed rows are upserted as `csv`. A rejected file
 * writes nothing. `allowOverApi=1` is the UI confirm for replacing `api` rows.
 */
export async function importSpendCsv(formData: FormData): Promise<ImportSpendCsvResult> {
  const companyId = await authorizedCompanyId();
  if (!companyId) return UNAUTHORIZED;

  const file = formData.get("file");
  if (!isFile(file) || file.size === 0) return invalid("Bir CSV dosyası seçin.");
  if (file.size > MAX_SPEND_CSV_BYTES) return invalid("Dosya 2 MB sınırını aşıyor.");

  const text = decodeCsv(await file.arrayBuffer());
  const instagramCampaignNames = await listInstagramCampaignNames(companyId);
  const parsed = parseSpendCsv(text, { instagramCampaignNames });
  if (!parsed.ok) return { ok: false, error: "rejected", message: parsed.reason };

  const dates = parsed.rows.map((r) => r.date).sort();
  const preview: SpendCsvPreview = {
    platform: parsed.platform,
    rows: parsed.rows.length,
    from: dates[0],
    to: dates[dates.length - 1],
    totalMinor: parsed.rows.reduce((sum, r) => sum + r.amountMinor, 0),
    duplicates: parsed.duplicates,
    skippedSummary: parsed.skippedSummary,
  };
  if (formData.get("dryRun") === "1") return { ok: true, dryRun: true, preview };

  const result = await upsertSpendRows({
    companyId,
    rows: parsed.rows,
    source: "csv",
    allowOverApi: formData.get("allowOverApi") === "1",
  });
  revalidateSpend();
  return { ok: true, dryRun: false, preview, ...result, duplicates: parsed.duplicates };
}
