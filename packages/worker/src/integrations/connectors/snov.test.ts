import { describe, expect, it, vi } from "vitest";
import { fetchSnovDomainEmails } from "./snov";

describe("fetchSnovDomainEmails", () => {
  it("returns missing_domain without calling fetch when domain is null", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchSnovDomainEmails({
      clientId: "client-id",
      clientSecret: "client-secret",
      domain: null,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      status: null,
      error: "missing_domain",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches token then domain emails on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ access_token: "token-123" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ emails: [] })),
      });

    const result = await fetchSnovDomainEmails({
      clientId: "client-id",
      clientSecret: "client-secret",
      domain: "acme.com",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: 200, json: { emails: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const tokenCall = fetchImpl.mock.calls[0];
    const tokenUrl = String(tokenCall[0]);
    expect(tokenUrl).toContain("api.snov.io");
    const tokenHeaders = tokenCall[1]?.headers as Record<string, string>;
    expect(tokenHeaders["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const tokenBody = String(tokenCall[1]?.body);
    expect(tokenBody).toBe(
      "grant_type=client_credentials&client_id=client-id&client_secret=client-secret",
    );
    expect(() => JSON.parse(tokenBody)).toThrow();

    const emailsCall = fetchImpl.mock.calls[1];
    const emailsUrl = String(emailsCall[0]);
    expect(emailsUrl).toContain("api.snov.io");
    const headers = emailsCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
  });
});
