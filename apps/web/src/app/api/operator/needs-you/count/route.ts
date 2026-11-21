import { loadNeedsYouForRequest } from "../shared";

// GET /api/operator/needs-you/count?companyId=… -> { count }
// The bell badge; equals the length of the viewer's Needs you list.
export async function GET(req: Request) {
  const result = await loadNeedsYouForRequest(req);
  if (!result.ok) return result.response;
  return Response.json({ count: result.list.total });
}
