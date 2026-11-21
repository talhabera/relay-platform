export function isResearchFresh(
  researchedAt: Date | null,
  days: number,
  now: Date = new Date(),
): boolean {
  if (researchedAt === null) return false;
  const windowMs = days * 24 * 60 * 60 * 1000;
  return now.getTime() - researchedAt.getTime() <= windowMs;
}
