import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHunterDomainSearch } from "./hunter";

describe("fetchHunterDomainSearch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok on 200 with JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: [] })),
    });

    const result = await fetchHunterDomainSearch({
      apiKey: "secret-key",
      domain: "acme.com",
      companyName: "Acme",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: 200, json: { data: [] } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("api.hunter.io");
  });

  it("returns not ok on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const result = await fetchHunterDomainSearch({
      apiKey: "secret-key",
      domain: "acme.com",
      companyName: "Acme",
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, status: 401, error: "http_401" });
  });

  it("does not log the api key", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: [] })),
    });

    await fetchHunterDomainSearch({
      apiKey: "secret-key",
      domain: "acme.com",
      companyName: "Acme",
      fetchImpl,
    });

    for (const call of consoleSpy.mock.calls) {
      const message = call.map(String).join(" ");
      expect(message).not.toContain("secret-key");
      expect(message).not.toContain("api.hunter.io");
    }
  });
});
