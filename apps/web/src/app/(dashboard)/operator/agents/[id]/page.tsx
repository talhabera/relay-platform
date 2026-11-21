import { redirect } from "next/navigation";

import { operatorAgentRedirect } from "@/app/(dashboard)/agents/operator/_canvas/operator-agent-redirect";

/** Operator agent settings moved into the operator canvas inspector (S59). */
export default async function OperatorAgentSettingsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ versionId?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  redirect(operatorAgentRedirect(id, query));
}
