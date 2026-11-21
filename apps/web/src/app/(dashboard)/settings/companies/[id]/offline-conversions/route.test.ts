import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireCompanyAccess, loadOfflineConversions } = vi.hoisted(() => ({
  requireCompanyAccess: vi.fn(),
  loadOfflineConversions: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/authorization", () => ({ requireCompanyAccess }));
vi.mock("@/lib/ads/offline-conversions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/offline-conversions")>()),
  loadOfflineConversions,
}));

import { GET } from "./route";

const COMPANY = { id: "company-1", timezone: "Europe/Istanbul" };
const params = (id = "company-1") => ({ params: Promise.resolve({ id }) });
const request = (query = "") =>
  new Request(`http://localhost/settings/companies/company-1/offline-conversions${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  requireCompanyAccess.mockResolvedValue({ session: {}, company: COMPANY });
  loadOfflineConversions.mockResolvedValue({
    rows: [
      {
        clickId: "Cj0KCQ-test",
        name: "Satış",
        at: new Date("2026-11-05T12:42:01Z"),
        valueMinor: 8_000_000,
        orderId: "rec-1:won",
      },
    ],
    skipped: { noGoogleClick: 2, invalidClickId: 1, wbraidOnly: 3 },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET offline conversions export", () => {
  it("returns a Google Ads CSV attachment without a BOM for the owner", async () => {
    const response = await GET(request("?from=2026-11-05&to=2026-11-05"), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="koleva-offline-conversions-2026-11-05-2026-11-05.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Export-Rows")).toBe("1");
    expect(response.headers.get("X-Export-Skipped-No-Click")).toBe("2");
    expect(response.headers.get("X-Export-Skipped-Invalid")).toBe("1");
    expect(response.headers.get("X-Export-Skipped-Wbraid")).toBe("3");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe(
      "Parameters:TimeZone=Europe/Istanbul\r\n" +
        "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID\r\n" +
        "Cj0KCQ-test,Satış,2026-11-05 15:42:01,80000.00,TRY,rec-1:won\r\n",
    );
    expect(loadOfflineConversions).toHaveBeenCalledWith(
      { marker: "db" },
      {
        companyId: "company-1",
        from: new Date("2026-11-04T21:00:00Z"),
        to: new Date("2026-11-05T21:00:00Z"),
      },
    );
  });

  it("answers 404 and reads nothing when the caller does not own the company", async () => {
    requireCompanyAccess.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(loadOfflineConversions).not.toHaveBeenCalled();
  });

  it("answers 409 timezone_not_set while the company zone is the UTC default", async () => {
    requireCompanyAccess.mockResolvedValue({ session: {}, company: { ...COMPANY, timezone: "UTC" } });

    const response = await GET(request("?from=2026-11-05&to=2026-11-05"), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "timezone_not_set" });
    expect(loadOfflineConversions).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "?from=2026-11-5&to=2026-11-06"],
    ["not a real date", "?from=2026-02-30&to=2026-03-02"],
    ["reversed", "?from=2026-11-06&to=2026-11-01"],
    ["over 92 days", "?from=2026-01-01&to=2026-04-03"],
    ["only one end", "?from=2026-11-01"],
  ])("answers 400 for a %s range", async (_label, query) => {
    const response = await GET(request(query), params());

    expect(response.status).toBe(400);
    expect(loadOfflineConversions).not.toHaveBeenCalled();
  });

  it("defaults to the last 7 local days ending yesterday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "koleva-offline-conversions-2026-10-30-2026-11-05.csv",
    );
    expect(loadOfflineConversions).toHaveBeenCalledWith(expect.anything(), {
      companyId: "company-1",
      from: new Date("2026-10-29T21:00:00Z"),
      to: new Date("2026-11-05T21:00:00Z"),
    });
  });

  it("uses the route company confirmed by requireCompanyAccess and ignores a company query parameter", async () => {
    await GET(request("?company=company-2&companyId=company-2&from=2026-11-05&to=2026-11-05"), params());

    expect(requireCompanyAccess).toHaveBeenCalledWith("company-1");
    expect(loadOfflineConversions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "company-1" }),
    );
  });
});
