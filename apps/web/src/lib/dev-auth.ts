import { timingSafeEqual } from "crypto";

export function isLocalDevAuthEnabled(): boolean {
  if (process.env.AUTH_DEV_ENABLED !== "true") return false;
  const authUrl = process.env.AUTH_URL ?? "";
  try {
    const hostname = new URL(authUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function isOidcConfigured(): boolean {
  const issuer = process.env.NEXAUTH_ISSUER ?? "";
  const clientId = process.env.NEXAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.NEXAUTH_CLIENT_SECRET ?? "";
  if (!/^https?:\/\//.test(issuer)) return false;
  if (
    issuer.includes("example-oidc.invalid") ||
    issuer.includes("your-oidc-provider")
  ) {
    return false;
  }
  if (
    !clientId ||
    clientId === "local-dev-client" ||
    clientId === "your-client-id"
  ) {
    return false;
  }
  if (
    !clientSecret ||
    clientSecret === "local-dev-secret" ||
    clientSecret === "your-client-secret"
  ) {
    return false;
  }
  return true;
}

export function expectedDevUsername(): string {
  return process.env.AUTH_DEV_USER || "operator";
}

export function verifyDevCredentials(
  username: string,
  password: string,
): boolean {
  if (!isLocalDevAuthEnabled()) return false;
  const expectedUser = expectedDevUsername();
  const expectedPass = process.env.AUTH_DEV_PASSWORD ?? "";
  if (!expectedPass || !password) return false;
  if (!safeEqual(username, expectedUser)) return false;
  return safeEqual(password, expectedPass);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
