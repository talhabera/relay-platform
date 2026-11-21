"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { companyHomeTiles } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";

import { saveHomeTilesSchema, toTileRows, type SaveHomeTilesInput } from "./edit-model";

/**
 * Edit Home Save (S106): writes one `company_home_tiles` row per tile for the
 * company. Owner-only (`requireCompanyAccess`). Reset to default saves the
 * default arrangement as rows, so a later catalog default change does not move it.
 */
export async function saveHomeTiles(input: SaveHomeTilesInput) {
  const { companyId, tiles } = saveHomeTilesSchema.parse(input);
  await requireCompanyAccess(companyId);

  const now = new Date();
  const rows = toTileRows(tiles).map((row) => ({ ...row, companyId, updatedAt: now }));

  await db
    .insert(companyHomeTiles)
    .values(rows)
    .onConflictDoUpdate({
      target: [companyHomeTiles.companyId, companyHomeTiles.tileKey],
      set: {
        visible: sql`excluded.visible`,
        position: sql`excluded.position`,
        visibility: sql`excluded.visibility`,
        requiredPermission: sql`excluded.required_permission`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  revalidatePath("/home");
  return { ok: true as const };
}
