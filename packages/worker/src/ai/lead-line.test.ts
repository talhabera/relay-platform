import { describe, expect, it } from "vitest";
import { isKodValid, parseLeadLine } from "./lead-line";

describe("isKodValid", () => {
  it("still accepts organik and a 5-char code for the pilot LEAD line", () => {
    expect(isKodValid("organik")).toBe(true);
    expect(isKodValid("A7F3K")).toBe(true);
    expect(isKodValid("abc")).toBe(false);
    expect(isKodValid(undefined)).toBe(false);
  });
});

describe("parseLeadLine", () => {
  it("parses a complete, valid LEAD line", () => {
    const text = [
      "Teşekkürler, tüm bilgileri aldım.",
      "LEAD tip=mutfak m2=140 lokasyon=Kadıköy butce=300-500k iletisim=dogrulandi skor=8 kod=A7F3K",
    ].join("\n");

    const result = parseLeadLine(text);

    expect(result.matched).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.fields).toEqual({
      tip: "mutfak",
      m2: "140",
      lokasyon: "Kadıköy",
      butce: "300-500k",
      iletisim: "dogrulandi",
      skor: "8",
      kod: "A7F3K",
    });
  });

  it("reports missing required fields and marks the line invalid", () => {
    const text = "LEAD tip=mutfak m2=140 iletisim=dogrulandi skor=8 kod=A7F3K";

    const result = parseLeadLine(text);

    expect(result.matched).toBe(true);
    expect(result.missingFields).toEqual(["lokasyon", "butce"]);
    expect(result.valid).toBe(false);
  });

  it("accepts kod=organik when the customer had no tracking code", () => {
    const text =
      "LEAD tip=banyo m2=25 lokasyon=Kadıköy butce=100-150k iletisim=dogrulandi skor=6 kod=organik";

    const result = parseLeadLine(text);

    expect(result.fields.kod).toBe("organik");
    expect(result.valid).toBe(true);
  });

  it("marks the line invalid when kod is missing entirely", () => {
    const text =
      "LEAD tip=banyo m2=25 lokasyon=Kadıköy butce=100-150k iletisim=dogrulandi skor=6";

    const result = parseLeadLine(text);

    expect(result.matched).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.fields.kod).toBeUndefined();
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed kod that isn't 5 alphanumeric chars or 'organik'", () => {
    const text =
      "LEAD tip=banyo m2=25 lokasyon=Kadıköy butce=100-150k iletisim=dogrulandi skor=6 kod=abc";

    const result = parseLeadLine(text);

    expect(result.valid).toBe(false);
  });

  it("rejects a skor outside the 1-10 range", () => {
    const text =
      "LEAD tip=banyo m2=25 lokasyon=Kadıköy butce=100-150k iletisim=dogrulandi skor=12 kod=A7F3K";

    const result = parseLeadLine(text);

    expect(result.valid).toBe(false);
  });

  it("returns matched=false when there is no LEAD line at all", () => {
    const result = parseLeadLine("Merhaba, size nasıl yardımcı olabilirim?");

    expect(result.matched).toBe(false);
    expect(result.missingFields).toEqual([
      "tip",
      "m2",
      "lokasyon",
      "butce",
      "iletisim",
    ]);
    expect(result.valid).toBe(false);
  });

  it("treats a key without '=' as malformed and leaves that field missing", () => {
    const text = "LEAD tip m2=140 lokasyon=Kadıköy butce=300-500k iletisim=dogrulandi";

    const result = parseLeadLine(text);

    expect(result.matched).toBe(true);
    expect(result.missingFields).toContain("tip");
    expect(result.valid).toBe(false);
  });
});
