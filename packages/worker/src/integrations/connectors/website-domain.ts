export type ConnectorHttpResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number | null; error: string };

export function websiteToDomain(
  website: string | null | undefined,
): string | null {
  if (website == null) {
    return null;
  }

  const trimmed = website.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let hostname: string;
  try {
    const parsed = new URL(trimmed);
    hostname = parsed.hostname;
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      hostname = parsed.hostname;
    } catch {
      return null;
    }
  }

  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  if (normalized.length === 0 || !normalized.includes(".")) {
    return null;
  }

  return normalized;
}
