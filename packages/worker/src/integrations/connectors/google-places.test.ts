import { describe, expect, it, vi } from "vitest";
import { fetchGooglePlacesSearch } from "./google-places";

describe("fetchGooglePlacesSearch", () => {
  it("returns ok on 200 with empty object body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });

    const result = await fetchGooglePlacesSearch({
      apiKey: "places-key",
      query: "Acme Corp",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: 200, json: {} });
  });
});
