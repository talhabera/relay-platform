/**
 * Back to Settings › Connectors after the Google round trip. The list shows
 * `connected` or `connectorError` as a toast, then drops the query.
 */
export function connectorsRedirect(
  req: Request,
  outcome: { connected: true } | { error: string },
): Response {
  const base = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.url;
  const url = new URL("/settings/connectors", base);
  if ("error" in outcome) {
    url.searchParams.set("connectorError", outcome.error);
  } else {
    url.searchParams.set("connected", "google_workspace");
  }
  return Response.redirect(url.toString(), 302);
}
