import { redirect } from "next/navigation";
import { auth } from "./auth";

export type AppSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  session: {
    expiresAt: Date;
  };
};

export async function getSession(): Promise<AppSession | null> {
  const raw = await auth();
  if (!raw?.user?.id) return null;
  return {
    user: {
      id: raw.user.id,
      name: raw.user.name ?? "",
      email: raw.user.email ?? "",
      image: raw.user.image,
    },
    session: {
      expiresAt: new Date(raw.expires),
    },
  };
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}
