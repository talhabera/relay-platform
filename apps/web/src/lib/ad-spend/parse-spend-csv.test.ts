import { describe, expect, it } from "vitest";

import { MAX_SPEND_CSV_ROWS, parseSpendCsv, parseSpendDate } from "./parse-spend-csv";

const BOM = "﻿";

const googleComma = [
  "Campaign report",
  '"November 3, 2026 - November 4, 2026"',
  "Day,Campaign,Campaign ID,Cost,Impr.,Clicks,Currency code",
  '2026-11-03,Web Arama,111,"1,234.56","1,200",40,TRY',
  "2026-11-04,Web Arama,111,467.00,900,31,TRY",
  "Total: Account,,,1701.56,2100,71,TRY",
].join("\r\n");

const googleSemicolon = [
  "Gün;Kampanya;Kampanya kimliği;Maliyet;Gösterim;Tıklamalar;Para birimi kodu",
  "03.11.2026;Web Arama;111;1.234,56;1.200;40;TRY",
  "04.11.2026;Web Arama;111;467,00;900;31;TRY",
  ";;;1.701,56;2.100;71;",
].join("\n");

const metaComma = [
  "Day,Campaign name,Amount spent (TRY),Impressions,Link clicks",
  "2026-11-04,WA Tiklama,350.5,5000,80",
  "2026-11-04,IG Retargeting,120,800,12",
].join("\n");

const metaSemicolon = [
  "Gün;Kampanya adı;Harcanan tutar (TRY);Gösterimler;Bağlantı tıklamaları",
  "04.11.2026;WA Tiklama;350,50;5.000;80",
  "04.11.2026;IG Retargeting;120;800;12",
].join("\r\n");

describe("parseSpendDate", () => {
  it("normalises both date forms", () => {
    expect(parseSpendDate("2026-11-04")).toBe("2026-11-04");
    expect(parseSpendDate("04.11.2026")).toBe("2026-11-04");
    expect(parseSpendDate("4.11.2026")).toBe("2026-11-04");
  });

  it("rejects impossible or unknown dates", () => {
    expect(parseSpendDate("31.02.2026")).toBeNull();
    expect(parseSpendDate("11/04/2026")).toBeNull();
    expect(parseSpendDate("2026-13-01")).toBeNull();
  });
});

describe("parseSpendCsv", () => {
  it.each([
    ["comma with BOM", BOM + googleComma],
    ["semicolon with BOM", BOM + googleSemicolon],
  ])("parses a Google-style file (%s) and skips the total row", (_label, csv) => {
    const result = parseSpendCsv(csv);
    expect(result).toEqual({
      ok: true,
      platform: "google",
      duplicates: 0,
      skippedSummary: 1,
      rows: [
        {
          date: "2026-11-03",
          channel: "google",
          campaignId: "111",
          campaignName: "Web Arama",
          amountMinor: 123456,
          impressions: 1200,
          clicks: 40,
        },
        {
          date: "2026-11-04",
          channel: "google",
          campaignId: "111",
          campaignName: "Web Arama",
          amountMinor: 46700,
          impressions: 900,
          clicks: 31,
        },
      ],
    });
  });

  it.each([
    ["comma with BOM", BOM + metaComma],
    ["semicolon with BOM", BOM + metaSemicolon],
  ])("parses a Meta-style file (%s) and splits Instagram retargeting by campaign name", (_label, csv) => {
    const result = parseSpendCsv(csv, { instagramCampaignNames: ["IG Retargeting"] });
    expect(result).toEqual({
      ok: true,
      platform: "meta",
      duplicates: 0,
      skippedSummary: 0,
      rows: [
        {
          date: "2026-11-04",
          channel: "meta",
          campaignId: "WA Tiklama",
          campaignName: "WA Tiklama",
          amountMinor: 35050,
          impressions: 5000,
          clicks: 80,
        },
        {
          date: "2026-11-04",
          channel: "instagram",
          campaignId: "IG Retargeting",
          campaignName: "IG Retargeting",
          amountMinor: 12000,
          impressions: 800,
          clicks: 12,
        },
      ],
    });
  });

  it("maps every Meta campaign to meta when no retargeting names are known", () => {
    const result = parseSpendCsv(metaComma);
    expect(result.ok && result.rows.map((r) => r.channel)).toEqual(["meta", "meta"]);
  });

  it("keeps the last row for a duplicate key and reports the count", () => {
    const csv = [
      "Day,Campaign name,Amount spent (TRY)",
      "2026-11-04,WA,100",
      "04.11.2026,WA,250",
    ].join("\n");
    const result = parseSpendCsv(csv);
    expect(result).toMatchObject({ ok: true, duplicates: 1 });
    expect(result.ok && result.rows).toEqual([
      { date: "2026-11-04", channel: "meta", campaignId: "WA", campaignName: "WA", amountMinor: 25000 },
    ]);
  });

  it("stores a formula-looking campaign name as plain text", () => {
    const csv = ['Day,Campaign name,Amount spent (TRY)', '2026-11-04,"=HYPERLINK(""http://x"",""y"")",10'].join("\n");
    const result = parseSpendCsv(csv);
    expect(result.ok && result.rows[0].campaignName).toBe('=HYPERLINK("http://x","y")');
  });

  describe("rejects the whole file with a reason", () => {
    const rejected = (csv: string) => {
      const result = parseSpendCsv(csv);
      expect(result.ok).toBe(false);
      expect("rows" in result).toBe(false);
      return result.ok ? "" : result.reason;
    };

    it("on an unknown header set", () => {
      expect(rejected("Tarih,Ürün,Adet\n2026-11-04,Kanepe,1")).toMatch(/Başlıklar tanınmadı/);
    });

    it("on a non-TRY currency header", () => {
      expect(rejected("Day,Campaign name,Amount spent (USD)\n2026-11-04,WA,10")).toMatch(/TRY değil/);
    });

    it("on a non-TRY currency column", () => {
      expect(rejected("Day,Campaign,Cost,Currency code\n2026-11-04,Web,10,EUR\n2026-11-03,Web,10,TRY")).toMatch(
        /Satır 2: para birimi TRY değil/,
      );
    });

    it("on an unparseable amount, even after good rows", () => {
      expect(rejected("Day,Campaign,Cost\n2026-11-03,Web,10\n2026-11-04,Web,on bin")).toMatch(/Satır 3: tutar okunamadı/);
    });

    it("on an unparseable date", () => {
      expect(rejected("Day,Campaign,Cost\n11/04/2026,Web,10")).toMatch(/tarih okunamadı/);
    });

    it(`on more than ${MAX_SPEND_CSV_ROWS} rows`, () => {
      const lines = ["Day,Campaign,Cost"];
      for (let i = 0; i <= MAX_SPEND_CSV_ROWS; i += 1) lines.push(`2026-11-04,C${i},1`);
      expect(rejected(lines.join("\n"))).toMatch(/satırdan fazla/);
    });

    it("on a file with no data rows", () => {
      expect(rejected("Day,Campaign,Cost\n")).toMatch(/harcama satırı yok/);
    });
  });
});
