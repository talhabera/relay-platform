/** Two-letter initials for Avatar fallbacks ("Acme GmbH" -> "AG"). */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return letters || "?";
}
