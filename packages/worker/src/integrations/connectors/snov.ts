import type { ConnectorHttpResult } from "./website-domain";
import { SNOV_DOMAIN_EMAILS_URL, SNOV_TOKEN_URL } from "./hosts";

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

export async function fetchSnovDomainEmails(input: {
  clientId: string;
  clientSecret: string;
  domain: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ConnectorHttpResult> {
  if (input.domain === null) {
    return { ok: false, status: null, error: "missing_domain" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;

  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });

  const tokenResult = await connectorFetch(fetchImpl, SNOV_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  if (!tokenResult.ok) {
    return tokenResult;
  }

  const tokenJson = tokenResult.json as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return { ok: false, status: tokenResult.status, error: "network" };
  }

  return connectorFetch(fetchImpl, SNOV_DOMAIN_EMAILS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ domain: input.domain }),
  });
}
