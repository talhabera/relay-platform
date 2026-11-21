import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth-server";
import { requireCompanyAccess } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/v2/primitives";
import { NoCompanyState, PageRestricted } from "@/components/v2/shell";

import { resolveSettingsCompany } from "../active-company";
import { loadCompanyPeople } from "../members/load-people";
import { SettingsHeader } from "../settings-header";
import { AccessMatrix } from "./access-matrix";
import { accessMatrixPeople } from "./matrix-people";

/** Settings › Access & roles (Figma 08c access): page access per member. Owner-only. */
export default async function SettingsAccessPage() {
  const session = await requireSession();
  const { company: active, isOwner, ownsAny } = await resolveSettingsCompany(session.user.id);

  if (!active) {
    return <NoCompanyState isOwner={ownsAny} />;
  }
  if (!isOwner) {
    return (
      <div>
        <SettingsHeader title="Access & roles" />
        <PageRestricted
          title="Access & roles isn't available"
          description="Only the company owner decides who sees which pages."
        />
      </div>
    );
  }

  const { company } = await requireCompanyAccess(active.id);
  const people = await loadCompanyPeople(company);
  if (!people) {
    notFound();
  }
  const { matrix, clientNote } = accessMatrixPeople(people);

  return (
    <div>
      <SettingsHeader
        title="Access & roles"
        description={`Choose which pages each member of ${company.name} can open.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/settings/members?add=1">
              <Icon name="plus" />
              Invite member
            </Link>
          </Button>
        }
      />
      <AccessMatrix companyId={company.id} people={matrix} />
      <p className="mt-4 flex items-start gap-2 type-small text-muted-foreground">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span>
          Owners always have every page. Members only see the pages you grant. Agents stay owner-only.
          Approve rights are granted per agent in the agent&apos;s Access settings.
          {clientNote ? ` ${clientNote}` : ""}
        </span>
      </p>
    </div>
  );
}
