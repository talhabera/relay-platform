import { describe, expect, it } from "vitest";
import { followUpDueDate, localToday, nextDueDate } from "./recurrence";

describe("nextDueDate", () => {
  it("daily adds one day, crossing month ends", () => {
    expect(nextDueDate("daily", "2026-01-31")).toBe("2026-02-01");
    expect(nextDueDate("daily", "2026-12-31")).toBe("2027-01-01");
  });

  it("weekly adds seven days, crossing month ends", () => {
    expect(nextDueDate("weekly", "2026-01-28")).toBe("2026-02-04");
    expect(nextDueDate("weekly", "2026-12-28")).toBe("2027-01-04");
  });

  it("monthly clamps to last day of next month", () => {
    expect(nextDueDate("monthly", "2026-01-31")).toBe("2026-02-28");
    expect(nextDueDate("monthly", "2026-03-31")).toBe("2026-04-30");
  });

  it("monthly clamps to Feb 29 in a leap year", () => {
    expect(nextDueDate("monthly", "2028-01-31")).toBe("2028-02-29");
  });

  it("monthly rolls December into January of next year", () => {
    expect(nextDueDate("monthly", "2026-12-15")).toBe("2027-01-15");
  });
});

describe("followUpDueDate", () => {
  it("counts from the due date when present", () => {
    expect(followUpDueDate("weekly", "2026-01-10", "2026-01-20")).toBe("2026-01-17");
  });

  it("counts from today when there is no due date", () => {
    expect(followUpDueDate("daily", null, "2026-01-20")).toBe("2026-01-21");
    expect(followUpDueDate("monthly", null, "2026-01-31")).toBe("2026-02-28");
  });
});

describe("localToday", () => {
  it("is the next day in a timezone ahead of UTC at 23:30 UTC", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");
    expect(localToday("Europe/Istanbul", now)).toBe("2026-01-16");
    expect(localToday("UTC", now)).toBe("2026-01-15");
    expect(localToday("America/New_York", now)).toBe("2026-01-15");
  });
});
