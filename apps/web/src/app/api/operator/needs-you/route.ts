import { topNeedsYou } from "@/lib/operator/needs-you";
import { loadNeedsYouForRequest } from "./shared";

// GET /api/operator/needs-you?companyId=…&view=top|all
// One server order (impact tier, then oldest first), filtered for the viewer.
// `top` (default) returns the first 5 for the Home tile and bell panel;
// `all` returns the full list for the Needs you page. `total` is the bell count.
export async function GET(req: Request) {
  const result = await loadNeedsYouForRequest(req);
  if (!result.ok) return result.response;
  const list = result.view === "all" ? result.list : topNeedsYou(result.list);
  return Response.json(list);
}
