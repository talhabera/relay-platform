import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companyMembers, users } from "@/db/schema";

export type UserProfileInput = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

export async function upsertUserFromProfile(
  profile: UserProfileInput,
): Promise<string> {
  const email = profile.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Email is required to sign in");
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  const name = profile.name?.trim() || email;
  const image = profile.image ?? null;

  if (existing) {
    await db
      .update(users)
      .set({
        name,
        image,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }

  const id = profile.id.trim();
  if (!id) {
    throw new Error("User id is required to sign in");
  }

  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    image,
  });
  return id;
}

/**
 * True when the user holds a `client` membership (spec
 * 2026-10-02-client-role-and-portal). Feeds the `isClient` session claim that
 * `gateRequest` uses to keep client users on `/client/*`.
 */
export async function isClientUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await db.query.companyMembers.findFirst({
    columns: { id: true },
    where: and(
      eq(companyMembers.userId, userId),
      eq(companyMembers.role, "client"),
    ),
  });
  return Boolean(row);
}
