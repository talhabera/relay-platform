import { afterEach, describe, expect, it, vi } from "vitest";
import { pingOperatorConnector } from "./connector-ping";

describe("pingOperatorConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pings Hunter with GET account", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingOperatorConnector({
      type: "hunter",
      apiKey: "hunter-key",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.hunter.io/v2/account?api_key=hunter-key",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("pings Snov with client credentials token POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"access_token":"tok"}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingOperatorConnector({
      type: "snov",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.snov.io/v1/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_id=client-id&client_secret=client-secret",
      }),
    );
  });

  it("pings Google Places with searchText ping query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"places":[]}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingOperatorConnector({
      type: "google_places",
      apiKey: "places-key",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Goog-Api-Key": "places-key",
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.websiteUri",
        }),
        body: JSON.stringify({ textQuery: "ping", maxResultCount: 1 }),
      }),
    );
  });

  it("returns error on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }),
    );

    const result = await pingOperatorConnector({
      type: "hunter",
      apiKey: "bad",
    });

    expect(result).toEqual({ ok: false, error: "http_401" });
  });
});
