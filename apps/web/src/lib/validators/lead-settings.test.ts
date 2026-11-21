import { describe, expect, it } from "vitest";
import { leadNotifyNumberSchema } from "./lead-settings";

describe("leadNotifyNumberSchema", () => {
  it.each(["+905551234567", "+14155552671"])("accepts %s", (whatsapp) => {
    expect(leadNotifyNumberSchema.parse({ whatsapp })).toEqual({ whatsapp });
  });

  it("turns an empty value into null (notifications off)", () => {
    expect(leadNotifyNumberSchema.parse({ whatsapp: "  " })).toEqual({ whatsapp: null });
  });

  it.each(["05551234567", "+0551234567", "+90 555 123 45 67", "905551234567", "+12345"])(
    "rejects %s",
    (whatsapp) => {
      expect(leadNotifyNumberSchema.safeParse({ whatsapp }).success).toBe(false);
    },
  );
});
