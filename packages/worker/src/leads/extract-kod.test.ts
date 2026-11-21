import { describe, expect, it } from "vitest";
import { extractKod } from "./extract-kod";

describe("extractKod", () => {
  it("reads the labeled code from the first message", () => {
    expect(extractKod("Merhaba, web sitesi için yazıyorum. (Kod: G7KF3)")).toBe("G7KF3");
    expect(extractKod("Merhaba (Kod: G7KF3)")).toBe("G7KF3");
  });

  it("uppercases a lowercase labeled code", () => {
    expect(extractKod("merhaba kod: g7kf3 yazıyorum")).toBe("G7KF3");
  });

  it("reads a fixed Meta code", () => {
    expect(extractKod("(Kod: MWEB1)")).toBe("MWEB1");
  });

  it("rejects a labeled value that is not exactly 5 alphanumeric chars", () => {
    expect(extractKod("(Kod: ABCDEF)")).toBeNull();
    expect(extractKod("(Kod: AB-12)")).toBeNull();
  });

  it("returns null for ordinary text with no label", () => {
    expect(extractKod("MERHABA SITEM")).toBeNull();
    expect(extractKod("Merhaba, web sitesi için yazıyorum.")).toBeNull();
    expect(extractKod("")).toBeNull();
  });

  it("accepts a bare token only with a channel letter and a digit", () => {
    expect(extractKod("G7KF3 merhaba")).toBe("G7KF3");
    expect(extractKod("MWEB1 merhaba")).toBe("MWEB1");
    expect(extractKod("R1234 merhaba")).toBe("R1234");
    expect(extractKod("HELLO")).toBeNull();
    expect(extractKod("GABCD merhaba")).toBeNull();
    expect(extractKod("A7F3K merhaba")).toBeNull();
  });

  it("returns the first match when two appear", () => {
    expect(extractKod("(Kod: G7KF3) (Kod: MWEB1)")).toBe("G7KF3");
    expect(extractKod("G7KF3 sonra MWEB1 geldi")).toBe("G7KF3");
  });
  it("ignores a bare token that starts with I, which is never issued", () => {
    expect(extractKod("I7KF3 merhaba")).toBeNull();
  });
});
