export function filterPipelineRecords<
  T extends { name: string; domain: string | null; status: string },
>(rows: T[], query: { q?: string; status?: string }): T[] {
  const q = query.q?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (query.status && row.status !== query.status) {
      return false;
    }
    if (!q) {
      return true;
    }
    const name = row.name.toLowerCase();
    const domain = row.domain?.toLowerCase() ?? "";
    return name.includes(q) || domain.includes(q);
  });
}
