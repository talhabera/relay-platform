export function assertWorkerSecret(
  authorizationHeader: string | null,
  secret: string,
): boolean {
  if (!secret) {
    return false;
  }
  return authorizationHeader === `Bearer ${secret}`;
}
