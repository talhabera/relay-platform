import { requireCompanyAccess } from "@relay/agent-ops/auth/access";
import { getSession } from "@/lib/auth-server";
import {
  buildGoogleConsentUrl,
  createOAuthState,
  googleOAuthConfig,
} from "@/lib/integrations/google-workspace";
import { connectorsRedirect } from "../redirect";

/**
 * GET /api/connectors/google-workspace/start?companyId=… (S73): the company
 * owner leaves for Google's consent screen (Gmail send-only).
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = new URL(req.url).searchParams.get("companyId");
  if (!companyId) {
    return Response.json({ error: "companyId is required" }, { status: 400 });
  }
  try {
    await requireCompanyAccess(session.user.id, companyId);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = googleOAuthConfig();
  const secret = process.env.AUTH_SECRET;
  if (!config || !secret) {
    return connectorsRedirect(req, {
      error: "Google sign-in isn't set up on this server yet.",
    });
  }

  const state = createOAuthState({ companyId, userId: session.user.id }, secret);
  return Response.redirect(
    buildGoogleConsentUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state }),
    302,
  );
}
