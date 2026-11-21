/**
 * Drizzle has no public API for inspecting a built `where`, so this reaches
 * into its internal `SQL` shape: each condition node exposes its operands via
 * `queryChunks`, and a column operand carries a `name` (snake_case DB name)
 * plus a `table` reference. It lets a test prove a tenancy clause is present
 * in the built query, which a mock that returns the same row cannot.
 */
export function collectColumnNames(node: unknown, names: string[] = []): string[] {
  if (node && typeof node === "object") {
    const candidate = node as {
      name?: unknown;
      table?: unknown;
      queryChunks?: unknown[];
    };
    if (typeof candidate.name === "string" && candidate.table !== undefined) {
      names.push(candidate.name);
    }
    if (Array.isArray(candidate.queryChunks)) {
      for (const chunk of candidate.queryChunks) {
        collectColumnNames(chunk, names);
      }
    }
  }
  return names;
}
