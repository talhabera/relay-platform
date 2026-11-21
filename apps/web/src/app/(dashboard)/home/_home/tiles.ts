import type { HomeTileKey, HomeTileVisibilityKind, PagePermissionKey } from "@relay/db/schema";
import type { HomeTileConfig, HomeTileVisibility, HomeViewer } from "@/lib/fixtures/interfaces";

// Home tiles (spec 2026-10-02-panel-chat-removal-and-home, decision 4). Pure:
// the catalog, its default arrangement, merging the owner's stored rows and
// filtering by viewer. Edit Home (S106) writes the rows this reads.

export type HomeColumn = "main" | "side";

/** Figma 04 `home/default`: Goal strip and Agent map on the left, the rest in the 400 column. */
export const HOME_TILE_COLUMN: Record<HomeTileKey, HomeColumn> = {
  daily_brief: "main",
  ad_report: "main",
  my_tasks: "side",
  goal_strip: "main",
  agent_map: "main",
  needs_you: "side",
  today: "side",
  lead_engine: "side",
};

export const HOME_TILE_LABEL: Record<HomeTileKey, string> = {
  goal_strip: "Goal strip",
  needs_you: "Needs you",
  today: "Today",
  lead_engine: "Lead engine",
  agent_map: "Agent map",
  daily_brief: "Daily brief",
  my_tasks: "My tasks",
  ad_report: "Koleva reklam",
};

/**
 * Default arrangement: Daily brief first, then Koleva reklam, then My tasks,
 * then Figma order. Koleva reklam is owners only (spend and revenue are owner
 * data; an owner can widen it in Edit Home). My tasks needs Operator access
 * (tasks live in the Operator Tasks tab); every other tile is shown to everyone.
 */
export const DEFAULT_HOME_TILES: readonly HomeTileConfig[] = [
  { key: "daily_brief", visible: true, order: 0, visibility: { kind: "everyone" } },
  { key: "ad_report", visible: true, order: 1, visibility: { kind: "owners_only" } },
  { key: "my_tasks", visible: true, order: 2, visibility: { kind: "requires", permission: "operator" } },
  { key: "goal_strip", visible: true, order: 3, visibility: { kind: "everyone" } },
  { key: "agent_map", visible: true, order: 4, visibility: { kind: "everyone" } },
  { key: "needs_you", visible: true, order: 5, visibility: { kind: "everyone" } },
  { key: "today", visible: true, order: 6, visibility: { kind: "everyone" } },
  { key: "lead_engine", visible: true, order: 7, visibility: { kind: "everyone" } },
];

/** A `company_home_tiles` row as read from the database. */
export type HomeTileRow = {
  tileKey: HomeTileKey;
  visible: boolean;
  position: number;
  visibility: HomeTileVisibilityKind;
  requiredPermission: PagePermissionKey | null;
};

export function rowVisibility(row: Pick<HomeTileRow, "visibility" | "requiredPermission">): HomeTileVisibility {
  if (row.visibility === "owners_only") return { kind: "owners_only" };
  if (row.visibility === "requires" && row.requiredPermission) {
    return { kind: "requires", permission: row.requiredPermission };
  }
  return { kind: "everyone" };
}

/**
 * The company's configuration in order. Stored rows override their tile's default;
 * a tile with no row keeps its default and sorts by its default order.
 */
export function resolveHomeTiles(rows: readonly HomeTileRow[]): HomeTileConfig[] {
  const byKey = new Map(rows.map((r) => [r.tileKey, r]));
  return DEFAULT_HOME_TILES.map((tile) => {
    const row = byKey.get(tile.key);
    return row
      ? { key: tile.key, visible: row.visible, order: row.position, visibility: rowVisibility(row) }
      : { ...tile };
  }).sort((a, b) => a.order - b.order || DEFAULT_ORDER[a.key] - DEFAULT_ORDER[b.key]);
}

const DEFAULT_ORDER = Object.fromEntries(DEFAULT_HOME_TILES.map((t) => [t.key, t.order])) as Record<
  HomeTileKey,
  number
>;

/** Owners see every tile; members only those whose visibility they meet. */
export function tileVisibleTo(visibility: HomeTileVisibility, viewer: HomeViewer): boolean {
  if (viewer.isOwner) return true;
  switch (visibility.kind) {
    case "everyone":
      return true;
    case "owners_only":
      return false;
    case "requires":
      return viewer.pagePermissions[visibility.permission] === true;
  }
}

/** Tiles this viewer sees, in order. Hidden tiles are hidden for owners too. */
export function visibleHomeTiles(config: readonly HomeTileConfig[], viewer: HomeViewer): HomeTileKey[] {
  return config.filter((t) => t.visible && tileVisibleTo(t.visibility, viewer)).map((t) => t.key);
}

/** Splits visible tiles into the two Home columns, keeping order within each. */
export function homeColumns(keys: readonly HomeTileKey[]): Record<HomeColumn, HomeTileKey[]> {
  return {
    main: keys.filter((k) => HOME_TILE_COLUMN[k] === "main"),
    side: keys.filter((k) => HOME_TILE_COLUMN[k] === "side"),
  };
}
