import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth-server";
import { requireCompanyAccess } from "@/lib/authorization";
import { NoCompanyState, PageRestricted } from "@/components/v2/shell";

import { resolveSettingsCompany } from "../active-company";
import { SettingsHeader } from "../settings-header";
import { loadCompanyPeople } from "./load-people";
import { MembersPanel, type MemberListRow } from "./members-panel";

const addedFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Members of the active company (Figma 08c members-*). Owner-only. */
export default async function SettingsMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const session = await requireSession();
  const { company: active, isOwner, ownsAny } = await resolveSettingsCompany(session.user.id);

  if (!active) {
    return <NoCompanyState isOwner={ownsAny} />;
  }
  if (!isOwner) {
    return (
      <div>
        <SettingsHeader title="Members" />
        <PageRestricted
          title="Members isn't available"
          description="Only the company owner manages members."
        />
      </div>
    );
  }

  const { company } = await requireCompanyAccess(active.id);
  const [people, params] = await Promise.all([loadCompanyPeople(company), searchParams]);
  if (!people) {
    notFound();
  }

  const rows: MemberListRow[] = people.map((p) => ({
    userId: p.userId,
    name: p.name,
    email: p.email,
    kind: p.kind,
    roleLabel: p.roleLabel,
    approvesOn: p.approvesOn,
    timeLabel:
      p.kind === "owner"
        ? "Company owner"
        : p.addedAt
          ? `Added ${addedFormat.format(p.addedAt)}`
          : "",
    removeCopy: p.removeCopy,
  }));

  return (
    <MembersPanel
      companyId={company.id}
      companyName={company.name}
      rows={rows}
      initialAddOpen={params.add === "1"}
    />
  );
}
