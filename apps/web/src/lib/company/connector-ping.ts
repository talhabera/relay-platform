const HUNTER_PING_URL = "https://api.hunter.io/v2/account";
const SNOV_TOKEN_URL = "https://api.snov.io/v1/oauth/access_token";
const GOOGLE_PLACES_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const GOOGLE_PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.websiteUri";

async function pingFetch(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, error: `http_${response.status}` };
    }

    return { ok: true };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return { ok: false, error: "timeout" };
    }

    return { ok: false, error: "network" };
  }
}

export async function pingOperatorConnector(
  input:
    | { type: "hunter"; apiKey: string }
    | { type: "snov"; clientId: string; clientSecret: string }
    | { type: "google_places"; apiKey: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (input.type) {
    case "hunter": {
      const url = `${HUNTER_PING_URL}?api_key=${encodeURIComponent(input.apiKey)}`;
      return pingFetch(url, { method: "GET" });
    }
    case "snov": {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: input.clientId,
        client_secret: input.clientSecret,
      });
      return pingFetch(SNOV_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    }
    case "google_places":
      return pingFetch(GOOGLE_PLACES_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": input.apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: "ping",
          maxResultCount: 1,
        }),
      });
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}
