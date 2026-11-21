import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies } from "@/lib/operator/companies";
import { ActiveCompanySelector } from "@/components/settings/active-company-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { getVapidPublicKey } from "@/lib/push/config";

import { SettingsHeader } from "../settings-header";
import { BrowserNotificationsToggle } from "./browser-notifications-toggle";

export default async function PreferencesPage() {
  const session = await requireSession();

  const [userCompanies, prefs] = await Promise.all([
    listAccessibleCompanies(session.user.id),
    db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, session.user.id),
    }),
  ]);

  const activeCompanyId = prefs?.activeCompanyId ?? userCompanies[0]?.id ?? null;

  return (
    <div>
      <SettingsHeader
        title="Preferences"
        description="How Relay looks, which company opens first and how this browser notifies you."
      />
      <div className="flex max-w-md flex-col gap-6">
        <ThemeSelector />
        <Field>
          <FieldTitle>Active company</FieldTitle>
          <ActiveCompanySelector
            companies={userCompanies}
            activeCompanyId={activeCompanyId}
          />
          <FieldDescription>
            Switching company changes which agents, inbox and analytics you see.
          </FieldDescription>
        </Field>
        <BrowserNotificationsToggle vapidPublicKey={getVapidPublicKey()} />
      </div>
    </div>
  );
}
