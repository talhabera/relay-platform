import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import {
  listAccessibleCompanies,
  resolveActiveCompanyId,
} from "@/lib/operator/companies";
import { resolvePagePermissions } from "@/lib/page-access";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { InboxShell } from "@/components/messaging/inbox-shell";
import { INBOX_TABS, type InboxTab } from "@/components/messaging/inbox-model";
import { loadInbox } from "./inbox-data";

function parseTab(value: string | undefined): InboxTab {
  return INBOX_TABS.includes(value as InboxTab) ? (value as InboxTab) : "all";
}

export default async function MessagingPage({
  searchParams,
}: {
  searchParams: Promise<{ chatId?: string; tab?: string }>;
}) {
  const session = await requireSession();
  const { chatId, tab } = await searchParams;

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const accessibleCompanies = await listAccessibleCompanies(session.user.id);
  const activeCompanyId = resolveActiveCompanyId(
    prefs?.activeCompanyId,
    accessibleCompanies,
  );
  const isOwner = accessibleCompanies.some(
    (company) => company.ownerId === session.user.id,
  );

  const activeCompany = activeCompanyId
    ? accessibleCompanies.find((company) => company.id === activeCompanyId)
    : undefined;
  if (!activeCompany) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  const permissions = await resolvePagePermissions(
    session.user.id,
    activeCompany,
  );
  if (!permissions.messaging) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, activeCompany.ownerId),
      columns: { name: true },
    });
    const who = owner?.name ? `${owner.name}, the company owner,` : "the company owner";
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <PageRestricted
          title="You do not have access to Inbox"
          description={`Ask ${who} to grant Inbox access in Settings › Access & roles.`}
        />
      </div>
    );
  }

  const data = await loadInbox({
    companyId: activeCompany.id,
    companyName: activeCompany.name,
    timeZone: activeCompany.timezone,
    chatId: chatId ?? null,
  });

  return (
    <InboxShell
      data={data}
      companyId={activeCompany.id}
      companyName={activeCompany.name}
      initialTab={parseTab(tab)}
      canOpenAgents={permissions.agents}
    />
  );
}
