import type { ConnectorHttpResult } from "./website-domain";
import { GOOGLE_PLACES_SEARCH_URL } from "./hosts";

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

export async function fetchGooglePlacesSearch(input: {
  apiKey: string;
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectorHttpResult> {
  const fetchImpl = input.fetchImpl ?? fetch;

  return connectorFetch(fetchImpl, GOOGLE_PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": input.apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.websiteUri",
    },
    body: JSON.stringify({
      textQuery: input.query,
      maxResultCount: 1,
    }),
  });
}
