import { NextResponse } from "next/server";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { getSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { activeCompanyId?: string };
  const { activeCompanyId } = body;

  if (!activeCompanyId) {
    return NextResponse.json(
      { error: "activeCompanyId is required" },
      { status: 400 }
    );
  }

  try {
    await requireCompanyMembership(activeCompanyId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized:")) {
      return NextResponse.json(
        { error: error.message.replace("Unauthorized: ", "") },
        { status: 403 },
      );
    }
    throw error;
  }

  await db
    .insert(userPreferences)
    .values({
      userId: session.user.id,
      activeCompanyId,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        activeCompanyId,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}
