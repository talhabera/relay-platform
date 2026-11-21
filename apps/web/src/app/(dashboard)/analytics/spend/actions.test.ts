import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAnalyticsAccess, upsertSpendRows, listInstagramCampaignNames, revalidatePath } = vi.hoisted(() => ({
  resolveAnalyticsAccess: vi.fn(),
  upsertSpendRows: vi.fn(),
  listInstagramCampaignNames: vi.fn(async () => [] as string[]),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../_overview/analytics-access", () => ({ resolveAnalyticsAccess }));
vi.mock("@/lib/ad-spend/spend-queries", () => ({ upsertSpendRows, listInstagramCampaignNames }));

import { MAX_SPEND_CSV_BYTES } from "@/lib/ad-spend/parse-spend-csv";

import { importSpendCsv, saveDailySpend } from "./actions";

const COMPANY = { id: "company-active" };
const WRITE_RESULT = { written: 2, overwritten: 1, skippedApi: 0, apiConflicts: [] };

function csvForm(content: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([content], "spend.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const META_CSV = "Day,Campaign name,Amount spent (TRY)\n2026-11-03,WA,100\n2026-11-04,WA,250\n2026-11-04,WA,300";

beforeEach(() => {
  vi.clearAllMocks();
  resolveAnalyticsAccess.mockResolvedValue({ kind: "ok", isOwner: true, company: COMPANY });
  upsertSpendRows.mockResolvedValue(WRITE_RESULT);
});

describe("saveDailySpend", () => {
  const input = {
    date: "2026-11-04",
    entries: [
      { channel: "google", amount: "1.234,56" },
      { channel: "instagram", amount: "" },
      { channel: "meta", amount: "0" },
    ],
  };

  it.each(["restricted", "no-company"])("returns unauthorized for %s and writes nothing", async (kind) => {
    resolveAnalyticsAccess.mockResolvedValue({ kind, isOwner: false, company: COMPANY });
    const result = await saveDailySpend(input);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("writes to the active company, ignores a client company id, skips empty and keeps a typed 0", async () => {
    const result = await saveDailySpend({ ...input, companyId: "company-other" } as typeof input);
    expect(resolveAnalyticsAccess).toHaveBeenCalledWith("user-1");
    expect(upsertSpendRows).toHaveBeenCalledWith({
      companyId: "company-active",
      source: "manual",
      allowOverApi: false,
      rows: [
        { date: "2026-11-04", channel: "google", campaignId: "", amountMinor: 123456 },
        { date: "2026-11-04", channel: "meta", campaignId: "", amountMinor: 0 },
      ],
    });
    expect(result).toEqual({ ok: true, written: 2, overwritten: 1, duplicates: 0, skippedApi: 0, apiConflicts: [] });
    expect(revalidatePath).toHaveBeenCalledWith("/analytics/spend");
    expect(revalidatePath).toHaveBeenCalledWith("/home");
  });

  it.each(["-5", "on bin", "1,2,3"])("rejects the amount %j and writes nothing", async (amount) => {
    const result = await saveDailySpend({ date: "2026-11-04", entries: [{ channel: "google", amount }] });
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("rejects an impossible date and an unknown channel", async () => {
    expect(await saveDailySpend({ date: "2026-02-30", entries: [{ channel: "google", amount: "1" }] })).toMatchObject({
      ok: false,
    });
    expect(await saveDailySpend({ date: "2026-11-04", entries: [{ channel: "tiktok", amount: "1" }] })).toMatchObject({
      ok: false,
    });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("passes the api overwrite confirm through", async () => {
    await saveDailySpend({ date: "2026-11-04", entries: [{ channel: "google", amount: "5" }], allowOverApi: true });
    expect(upsertSpendRows).toHaveBeenCalledWith(expect.objectContaining({ allowOverApi: true }));
  });
});

describe("importSpendCsv", () => {
  it.each(["restricted", "no-company"])("returns unauthorized for %s", async (kind) => {
    resolveAnalyticsAccess.mockResolvedValue({ kind, isOwner: false });
    expect(await importSpendCsv(csvForm(META_CSV))).toMatchObject({ ok: false, error: "unauthorized" });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("writes nothing when the parser rejects the file", async () => {
    const result = await importSpendCsv(csvForm("Day,Campaign,Cost\n2026-11-04,Web,on bin"));
    expect(result).toMatchObject({ ok: false, error: "rejected" });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("previews without writing on a dry run", async () => {
    const result = await importSpendCsv(csvForm(META_CSV, { dryRun: "1" }));
    expect(result).toEqual({
      ok: true,
      dryRun: true,
      preview: {
        platform: "meta",
        rows: 2,
        from: "2026-11-03",
        to: "2026-11-04",
        totalMinor: 40000,
        duplicates: 1,
        skippedSummary: 0,
      },
    });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("writes csv rows for the active company and reports the counts", async () => {
    const form = csvForm(META_CSV, { companyId: "company-other" });
    const result = await importSpendCsv(form);
    expect(upsertSpendRows).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "company-active", source: "csv", allowOverApi: false }),
    );
    expect(result).toMatchObject({ ok: true, dryRun: false, written: 2, overwritten: 1, duplicates: 1, skippedApi: 0 });
  });

  it("rejects a file above 2 MB", async () => {
    const result = await importSpendCsv(csvForm("x".repeat(MAX_SPEND_CSV_BYTES + 1)));
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(upsertSpendRows).not.toHaveBeenCalled();
  });

  it("decodes a windows-1254 file", async () => {
    // "Gün;Kampanya;Maliyet" with ü as 0xFC in windows-1254.
    const header = [0x47, 0xfc, 0x6e, 0x3b, ...Buffer.from("Kampanya;Maliyet\n2026-11-04;Web;10")];
    const form = new FormData();
    form.set("file", new File([new Uint8Array(header)], "spend.csv"));
    form.set("dryRun", "1");
    expect(await importSpendCsv(form)).toMatchObject({ ok: true, preview: { platform: "google", rows: 1 } });
  });
});
