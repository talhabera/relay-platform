import { describe, expect, it } from "vitest";

import { minorToTryLabel, parseTryToMinor } from "./money";

describe("parseTryToMinor", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234.56", 123456],
    ["1,234.56", 123456],
    ["1234,5", 123450],
    ["1.234", 123400],
    ["467", 46700],
    ["0", 0],
    ["₺467,00", 46700],
    ["467,00 TL", 46700],
    ["  1.234.567,89  ", 123456789],
    ["467 TRY", 46700],
  ])("parses %j to %i", (input, expected) => {
    expect(parseTryToMinor(input)).toBe(expected);
  });

  it("reads Turkish and English forms of the same amount as the same integer", () => {
    expect(parseTryToMinor("1.234,56")).toBe(parseTryToMinor("1234.56"));
  });

  it.each(["", "   ", "abc", "-5", "1,2,3", "12.34.56", "1.23,4.5", "1e5", "Infinity", "12,345,6"])(
    "returns null for %j",
    (input) => {
      expect(parseTryToMinor(input)).toBeNull();
    },
  );

  it("returns null for amounts beyond a safe integer", () => {
    expect(parseTryToMinor("999999999999999999999")).toBeNull();
  });
});

describe("minorToTryLabel", () => {
  it("formats with Turkish separators and drops a zero fraction", () => {
    expect(minorToTryLabel(123456)).toBe("1.234,56 TL");
    expect(minorToTryLabel(46700)).toBe("467 TL");
    expect(minorToTryLabel(0)).toBe("0 TL");
    expect(minorToTryLabel(5)).toBe("0,05 TL");
    expect(minorToTryLabel(123456789)).toBe("1.234.567,89 TL");
  });
});
