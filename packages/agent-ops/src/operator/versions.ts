import { and, eq } from "drizzle-orm";
import { agentVersions, db } from "@relay/db";
import { requireOperatorAgentEdit } from "../auth/access";

export function nextLiveStatuses(currentLiveId: string, targetId: string) {
  if (currentLiveId === targetId) return null;
  return { demoteId: currentLiveId, promoteId: targetId };
}

export async function getLiveVersion(agentId: string) {
  return db.query.agentVersions.findFirst({
    where: and(
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.status, "live"),
    ),
  });
}

export async function promoteOperatorVersion(
  userId: string,
  versionId: string,
) {
  const version = await db.query.agentVersions.findFirst({
    where: eq(agentVersions.id, versionId),
  });

  if (!version) {
    throw new Error("Version not found");
  }

  await requireOperatorAgentEdit(userId, version.agentId);

  const live = await getLiveVersion(version.agentId);
  if (!live) {
    throw new Error("No live version to replace");
  }

  const swap = nextLiveStatuses(live.id, version.id);
  if (!swap) {
    return { versionId };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(agentVersions)
      .set({ status: "draft" })
      .where(eq(agentVersions.id, swap.demoteId));
    await tx
      .update(agentVersions)
      .set({ status: "live" })
      .where(eq(agentVersions.id, swap.promoteId));
  });

  return { versionId };
}
