import { revalidatePath } from "next/cache";
import { requireCompanyAccess } from "@relay/agent-ops/auth/access";
import { getSession } from "@/lib/auth-server";
import {
  exchangeGoogleCode,
  googleOAuthConfig,
  verifyOAuthState,
} from "@/lib/integrations/google-workspace";
import { saveGoogleWorkspaceConnector } from "@/lib/integrations/google-workspace-connector";
import { connectorsRedirect } from "../redirect";

/**
 * GET /api/connectors/google-workspace/callback (S73): Google's redirect
 * after consent. The signed state must name the signed-in owner; only then is
 * the code traded and the refresh token stored on the company's row.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const secret = process.env.AUTH_SECRET ?? "";
  const state = verifyOAuthState(params.get("state"), secret);
  if (!state || state.userId !== session.user.id) {
    return connectorsRedirect(req, {
      error: "That Google sign-in link expired. Connect Google Workspace again.",
    });
  }
  try {
    await requireCompanyAccess(session.user.id, state.companyId);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (params.get("error")) {
    // access_denied: the owner cancelled on Google's screen.
    return connectorsRedirect(req, { error: "Google Workspace wasn't connected." });
  }
  const code = params.get("code");
  const config = googleOAuthConfig();
  if (!code || !config) {
    return connectorsRedirect(req, { error: "Google sign-in failed. Try again." });
  }

  const result = await exchangeGoogleCode({ config, code });
  if (!result.ok) {
    return connectorsRedirect(req, { error: result.error });
  }

  await saveGoogleWorkspaceConnector(state.companyId, {
    refreshToken: result.refreshToken,
    email: result.email,
    scope: result.scope,
  });
  revalidatePath("/settings/connectors");
  revalidatePath(`/settings/companies/${state.companyId}`);
  return connectorsRedirect(req, { connected: true });
}
