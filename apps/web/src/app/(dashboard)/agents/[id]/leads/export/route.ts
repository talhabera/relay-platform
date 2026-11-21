import { requireAgentAccess } from "@/lib/authorization";
import { leadsToCsv } from "@/lib/leads-csv";
import { exportAgentLeads, parseLeadStatus } from "@/lib/leads-queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let agent;
  try {
    ({ agent } = await requireAgentAccess(id));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (agent.kind === "operator") {
    return new Response("Not found", { status: 404 });
  }

  const status = parseLeadStatus(new URL(request.url).searchParams.get("status"));
  const rows = await exportAgentLeads(agent, status);

  return new Response(leadsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${agent.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
