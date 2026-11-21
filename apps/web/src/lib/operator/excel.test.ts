import { randomBytes } from "crypto";
import { describe, expect, it } from "vitest";
import { buildExcelWorkbook } from "./excel";

describe("buildExcelWorkbook", () => {
  it("builds a workbook with one sheet and two rows", async () => {
    const buffer = await buildExcelWorkbook([
      {
        name: "Sheet1",
        rows: [
          ["Name", "Qty"],
          ["Widget", "3"],
        ],
      },
    ]);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("throws when row count exceeds 10000", async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => [`row-${i}`]);

    await expect(
      buildExcelWorkbook([{ name: "Sheet1", rows }]),
    ).rejects.toThrow("Excel exceeds 10000 rows");
  });

  it("throws when workbook exceeds 5MB", async () => {
    const rows = Array.from({ length: 10_000 }, () => [
      randomBytes(200).toString("hex"),
      randomBytes(200).toString("hex"),
      randomBytes(200).toString("hex"),
    ]);

    await expect(
      buildExcelWorkbook([{ name: "Sheet1", rows }]),
    ).rejects.toThrow("Excel exceeds 5MB");
  });
});
