import { requireSession } from "@/lib/auth-server";
import {
  getLiveVersion as getLiveVersionImpl,
  nextLiveStatuses,
  promoteOperatorVersion as promoteOperatorVersionForUser,
} from "@relay/agent-ops/operator/versions";

export { nextLiveStatuses };
export const getLiveVersion = getLiveVersionImpl;

export async function promoteOperatorVersion(versionId: string) {
  const session = await requireSession();
  await promoteOperatorVersionForUser(session.user.id, versionId);
}
