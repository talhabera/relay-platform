import { getSession } from "@/lib/auth-server";
import { requireLeadSession } from "@/lib/leads/session-access";
import { exportSessionLeads, sessionLeadsToCsv } from "@/lib/leads/session-leads";
import { parseSessionLeadTab } from "@/components/operator/session/panes/leads/leads-pane-model";

/**
 * Leads work pane Export CSV: every lead on the tab, uncapped (the pane lists
 * 500 at most; the export is what gets billed). Cells are formula-escaped.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { chatId } = await params;
  const tab = parseSessionLeadTab(new URL(request.url).searchParams.get("tab")) ?? "qualified";

  let access;
  try {
    access = await requireLeadSession(chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.startsWith("Unauthorized")
      ? new Response("Forbidden", { status: 403 })
      : new Response("Not found", { status: 404 });
  }

  const rows = await exportSessionLeads(access.window, tab);
  return new Response(sessionLeadsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${tab}-${access.weekId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
