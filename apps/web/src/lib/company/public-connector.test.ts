import { describe, expect, it } from "vitest";
import { toPublicConnector } from "./public-connector";

describe("toPublicConnector", () => {
  it("exposes credential booleans without secrets", () => {
    const result = toPublicConnector({
      id: "int-1",
      type: "hunter",
      status: "connected",
      error: null,
      config: { hunter: { apiKey: "secret" } },
    });

    expect(result.hasHunterKey).toBe(true);
    expect(result.hasSnov).toBe(false);
    expect(result.hasPlacesKey).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result).not.toHaveProperty("config");
  });

  it("detects snov and google places credentials", () => {
    const snov = toPublicConnector({
      id: "int-2",
      type: "snov",
      status: "connected",
      error: null,
      config: {
        snov: { clientId: "id", clientSecret: "sec" },
      },
    });
    expect(snov.hasSnov).toBe(true);
    expect(JSON.stringify(snov)).not.toContain("sec");

    const places = toPublicConnector({
      id: "int-3",
      type: "google_places",
      status: "error",
      error: "Invalid key",
      config: { googlePlaces: { apiKey: "places-key" } },
    });
    expect(places.hasPlacesKey).toBe(true);
    expect(JSON.stringify(places)).not.toContain("places-key");
  });
});
