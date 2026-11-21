import { requireSession } from "./auth-server";
import {
  requireCompanyAccess as requireCompanyAccessForUser,
  requireAgentAccess as requireAgentAccessForUser,
} from "@relay/agent-ops/auth/access";

export async function requireCompanyAccess(companyId: string) {
  const session = await requireSession();
  const { company } = await requireCompanyAccessForUser(session.user.id, companyId);
  return { session, company };
}

export async function requireAgentAccess(agentId: string) {
  const session = await requireSession();
  const { agent } = await requireAgentAccessForUser(session.user.id, agentId);
  return { session, agent };
}
