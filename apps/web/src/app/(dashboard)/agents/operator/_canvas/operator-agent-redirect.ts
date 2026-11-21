/**
 * `/operator/agents/[id]` moved to the operator canvas (S59). The old `?versionId=` (the
 * settings form's version picker) becomes the canvas `?version=`.
 */
export function operatorAgentRedirect(agentId: string, query: { versionId?: string | string[] }): string {
  const params = new URLSearchParams({ agent: agentId });
  if (typeof query.versionId === "string" && query.versionId) params.set("version", query.versionId);
  return `/agents/operator?${params.toString()}`;
}
