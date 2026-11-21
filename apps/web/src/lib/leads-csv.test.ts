import { describe, expect, it } from "vitest";
import { escapeCsvCell, leadsToCsv } from "./leads-csv";

describe("escapeCsvCell", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"])(
    "neutralises the formula prefix in %s",
    (value) => {
      expect(escapeCsvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
  });

  it("writes null as empty, numbers as-is and dates as ISO", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(8)).toBe("8");
    expect(escapeCsvCell(new Date("2026-09-30T10:00:00Z"))).toBe("2026-09-30T10:00:00.000Z");
  });
});

describe("leadsToCsv", () => {
  const ROW = {
    kod: "A7F3K", tip: "mutfak", m2: "140", lokasyon: "Kadıköy", butce: "300-500k",
    iletisim: "dogrulandi", skor: 8, status: "qualified", channelType: "widget",
    createdAt: new Date("2026-09-30T10:00:00Z"),
  };

  it("starts with a UTF-8 BOM so Excel reads Turkish characters", () => {
    expect(leadsToCsv([ROW]).startsWith("\uFEFF")).toBe(true);
  });

  it("writes a fixed header and one line per lead", () => {
    const lines = leadsToCsv([ROW]).replace("\uFEFF", "").split("\r\n");

    expect(lines[0]).toBe("kod,tip,m2,lokasyon,butce,iletisim,skor,status,channelType,createdAt");
    expect(lines[1]).toBe("A7F3K,mutfak,140,Kadıköy,300-500k,dogrulandi,8,qualified,widget,2026-09-30T10:00:00.000Z");
  });

  it("keeps the header when there are no leads", () => {
    expect(leadsToCsv([]).replace("\uFEFF", "").split("\r\n")).toHaveLength(1);
  });
});
