import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies } from "@/lib/operator/companies";
import { listPagePermissionsByCompanyId } from "@/lib/page-access";
import { SessionProvider } from "@/components/shared/session-provider";
import { CompanyContextProvider } from "@/components/shared/company-context";
import { AppShellHeader } from "@/components/layout/app-shell";
import { AppMain } from "@/components/layout/app-main";
import { Toaster } from "@/components/ui/sonner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const userCompanies = await listAccessibleCompanies(session.user.id);

  // Fetch user preferences for active company
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const activeCompanyId = prefs?.activeCompanyId ?? userCompanies[0]?.id ?? null;
  const permissionsByCompanyId = await listPagePermissionsByCompanyId(
    session.user.id,
    userCompanies,
  );

  return (
    <SessionProvider
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      <CompanyContextProvider
        companies={userCompanies}
        initialActiveCompanyId={activeCompanyId}
        userId={session.user.id}
        permissionsByCompanyId={permissionsByCompanyId}
      >
        <div className="relative flex h-svh flex-col bg-background">
          <AppShellHeader
            user={{ name: session.user.name, image: session.user.image }}
          />
          <AppMain>{children}</AppMain>
        </div>
        <Toaster />
      </CompanyContextProvider>
    </SessionProvider>
  );
}
