import type { ConnectorHttpResult } from "./website-domain";
import { HUNTER_DOMAIN_SEARCH_URL } from "./hosts";

export type { ConnectorHttpResult };

async function connectorFetch(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<ConnectorHttpResult> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `http_${response.status}`,
      };
    }

    const json =
      text.length === 0 ? {} : (JSON.parse(text) as unknown);
    return { ok: true, status: response.status, json };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return { ok: false, status: null, error: "timeout" };
    }

    return { ok: false, status: null, error: "network" };
  }
}

export async function fetchHunterDomainSearch(input: {
  apiKey: string;
  domain: string | null;
  companyName: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectorHttpResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    company: input.companyName,
    api_key: input.apiKey,
  });

  if (input.domain !== null) {
    params.set("domain", input.domain);
  }

  const url = `${HUNTER_DOMAIN_SEARCH_URL}?${params.toString()}`;
  return connectorFetch(fetchImpl, url, { method: "GET" });
}
