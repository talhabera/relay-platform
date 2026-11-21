import { eq } from "drizzle-orm";

import { db } from "@/db";
import { companyHomeTiles } from "@/db/schema";
import type { HomeTilesReader } from "@/lib/fixtures/interfaces";

import { resolveHomeTiles, visibleHomeTiles } from "./tiles";

/** Database `HomeTilesReader` over `company_home_tiles` (the fixture reader's twin). */
export const homeTilesReader: HomeTilesReader = {
  async getHomeTiles(companyId) {
    const rows = await db
      .select({
        tileKey: companyHomeTiles.tileKey,
        visible: companyHomeTiles.visible,
        position: companyHomeTiles.position,
        visibility: companyHomeTiles.visibility,
        requiredPermission: companyHomeTiles.requiredPermission,
      })
      .from(companyHomeTiles)
      .where(eq(companyHomeTiles.companyId, companyId));
    return resolveHomeTiles(rows);
  },
  async getVisibleHomeTiles(companyId, viewer) {
    return visibleHomeTiles(await this.getHomeTiles(companyId), viewer);
  },
};
