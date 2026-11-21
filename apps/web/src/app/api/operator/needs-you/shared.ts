import { z } from "zod";
import { getSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";
import { getNeedsYou, type NeedsYouList } from "@/lib/operator/needs-you";

export const needsYouQuerySchema = z.object({
  companyId: z.string().uuid(),
  view: z.enum(["top", "all"]).default("top"),
});

/** Session, membership, then the viewer's ordered Needs you list. */
export async function loadNeedsYouForRequest(
  req: Request,
): Promise<
  | { ok: true; list: NeedsYouList; view: "top" | "all" }
  | { ok: false; response: Response }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  const url = new URL(req.url);
  const query = needsYouQuerySchema.safeParse({
    companyId: url.searchParams.get("companyId") ?? undefined,
    view: url.searchParams.get("view") ?? undefined,
  });
  if (!query.success) {
    return { ok: false, response: new Response("Invalid query", { status: 400 }) };
  }

  let ownerId: string;
  try {
    const { company } = await requireCompanyMembership(query.data.companyId);
    ownerId = company.ownerId;
  } catch {
    return { ok: false, response: new Response("Forbidden", { status: 403 }) };
  }

  const list = await getNeedsYou({
    companyId: query.data.companyId,
    viewerId: session.user.id,
    ownerId,
  });
  return { ok: true, list, view: query.data.view };
}
