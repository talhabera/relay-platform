import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";

import { homeTilesReader } from "../_home/load-tiles";
import { EditHomeForm } from "./edit-home-form";

/**
 * Edit Home (Figma 04 `home/edit`): owner-only full-page mode entered from the
 * "Edit Home" button. Members get the page-restricted state, not a redirect.
 */
export default async function EditHomePage() {
  const session = await requireSession();
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);
  const companies = await listAccessibleCompanies(session.user.id);
  const company = companies.find((c) => c.id === resolveActiveCompanyId(prefs?.activeCompanyId, companies));
  if (!company) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={companies.some((c) => c.ownerId === session.user.id)} />
      </SystemStateFrame>
    );
  }

  if (company.ownerId !== session.user.id) {
    return (
      <div className="flex justify-center pt-10">
        <PageRestricted
          title="Only owners can edit Home"
          description="Ask a company owner to change which Home tiles you see."
        />
      </div>
    );
  }

  const tiles = await homeTilesReader.getHomeTiles(company.id);
  return <EditHomeForm companyId={company.id} companyName={company.name} initialTiles={tiles} />;
}
