import { z } from "zod";

import {
  HOME_TILE_KEYS,
  PAGE_PERMISSION_KEYS,
  type HomeTileKey,
  type PagePermissionKey,
  type PagePermissions,
} from "@relay/db/schema";
import type { HomeTileConfig, HomeTileVisibility } from "@/lib/fixtures/interfaces";

import { HOME_TILE_COLUMN, tileVisibleTo, type HomeColumn, type HomeTileRow } from "../_home/tiles";

// Edit Home (S106, Figma 04 `home/edit`). Pure: column lists, reordering,
// visibility options, preview and the save payload. The page writes
// `company_home_tiles`; `_home/tiles.ts` reads it back.

export const HOME_COLUMNS: readonly HomeColumn[] = ["main", "side"];

export const HOME_COLUMN_COPY: Record<HomeColumn, { title: string; hint: string }> = {
  main: { title: "Main column", hint: "Wide tiles, left side of Home" },
  side: { title: "Side column", hint: "Narrow tiles, right side of Home" },
};

export const HOME_TILE_DESCRIPTION: Record<HomeTileKey, string> = {
  daily_brief: "This morning's brief from the Daily manager: what to do, set up and decide today",
  my_tasks: "Your open tasks: overdue first, then due today, then in progress",
  ad_report: "Yesterday and month-to-date ad spend, leads and sales per channel, cash in and warnings",
  goal_strip: "Weekly goal, lead quality score and cost per qualified lead",
  agent_map: "Live map of sources, customer agents and operator agents",
  needs_you: "Checkpoints, agent questions and failed runs waiting on a person",
  today: "Today's scheduled runs and their results",
  lead_engine: "This week's lead funnel, from gathered to delivered",
};

/** Page permission names as the nav shows them (`messaging` is Inbox). */
export const PAGE_PERMISSION_LABEL: Record<PagePermissionKey, string> = {
  operator: "Operator",
  agents: "Agents",
  messaging: "Inbox",
  analytics: "Analytics",
};

// ---------------------------------------------------------------------------
// Visibility <-> Select value

export type VisibilityValue = "everyone" | "owners_only" | `requires:${PagePermissionKey}`;

export function visibilityValue(v: HomeTileVisibility): VisibilityValue {
  return v.kind === "requires" ? `requires:${v.permission}` : v.kind;
}

export function parseVisibilityValue(value: string): HomeTileVisibility {
  if (value === "owners_only") return { kind: "owners_only" };
  if (value.startsWith("requires:")) {
    const permission = value.slice("requires:".length);
    if ((PAGE_PERMISSION_KEYS as readonly string[]).includes(permission)) {
      return { kind: "requires", permission: permission as PagePermissionKey };
    }
  }
  return { kind: "everyone" };
}

export function visibilityLabel(v: HomeTileVisibility): string {
  if (v.kind === "owners_only") return "Owners only";
  if (v.kind === "requires") return `Requires ${PAGE_PERMISSION_LABEL[v.permission]} access`;
  return "Everyone";
}

export const VISIBILITY_OPTIONS: { value: VisibilityValue; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  ...PAGE_PERMISSION_KEYS.map((permission) => ({
    value: `requires:${permission}` as const,
    label: visibilityLabel({ kind: "requires", permission }),
  })),
  { value: "owners_only", label: "Owners only" },
];

// ---------------------------------------------------------------------------
// Ordering

const byOrder = (a: HomeTileConfig, b: HomeTileConfig) => a.order - b.order;

/** Tiles of each column, in order. */
export function editColumns(config: readonly HomeTileConfig[]): Record<HomeColumn, HomeTileConfig[]> {
  const sorted = [...config].sort(byOrder);
  return {
    main: sorted.filter((t) => HOME_TILE_COLUMN[t.key] === "main"),
    side: sorted.filter((t) => HOME_TILE_COLUMN[t.key] === "side"),
  };
}

/** Flattens columns back to one list with dense positions: main first, then side. */
function renumber(columns: Record<HomeColumn, HomeTileConfig[]>): HomeTileConfig[] {
  return [...columns.main, ...columns.side].map((t, order) => ({ ...t, order }));
}

/**
 * Moves `key` to `toIndex` within its own column. Tiles never change column:
 * the column is fixed by the tile's width. Out-of-range indexes clamp.
 */
export function moveTile(config: readonly HomeTileConfig[], key: HomeTileKey, toIndex: number): HomeTileConfig[] {
  const columns = editColumns(config);
  const column = HOME_TILE_COLUMN[key];
  const list = columns[column];
  const from = list.findIndex((t) => t.key === key);
  if (from === -1) return renumber(columns);
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  const next = [...list];
  const [tile] = next.splice(from, 1);
  next.splice(to, 0, tile);
  return renumber({ ...columns, [column]: next });
}

export function updateTile(
  config: readonly HomeTileConfig[],
  key: HomeTileKey,
  patch: Partial<Pick<HomeTileConfig, "visible" | "visibility">>,
): HomeTileConfig[] {
  return config.map((t) => (t.key === key ? { ...t, ...patch } : t));
}

/** Same tiles, order, Show and visibility. */
export function sameConfig(a: readonly HomeTileConfig[], b: readonly HomeTileConfig[]): boolean {
  const left = renumber(editColumns(a));
  const right = renumber(editColumns(b));
  return (
    left.length === right.length &&
    left.every((t, i) => {
      const u = right[i];
      return (
        t.key === u.key &&
        t.visible === u.visible &&
        visibilityValue(t.visibility) === visibilityValue(u.visibility)
      );
    })
  );
}

// ---------------------------------------------------------------------------
// Preview

export type PreviewMode = "owner" | "member";

export type PreviewTile = { key: HomeTileKey; hidden: boolean };

const NO_PERMISSIONS = Object.fromEntries(PAGE_PERMISSION_KEYS.map((k) => [k, false])) as PagePermissions;

/**
 * What Home looks like after Save. Owner: every tile, hidden ones marked.
 * Member: a member with no page permissions, so only shown `everyone` tiles.
 */
export function previewColumns(
  config: readonly HomeTileConfig[],
  mode: PreviewMode,
): Record<HomeColumn, PreviewTile[]> {
  const columns = editColumns(config);
  const pick = (tiles: HomeTileConfig[]): PreviewTile[] =>
    mode === "owner"
      ? tiles.map((t) => ({ key: t.key, hidden: !t.visible }))
      : tiles
          .filter((t) => t.visible && tileVisibleTo(t.visibility, { isOwner: false, pagePermissions: NO_PERMISSIONS }))
          .map((t) => ({ key: t.key, hidden: false }));
  return { main: pick(columns.main), side: pick(columns.side) };
}

// ---------------------------------------------------------------------------
// Save payload

const visibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("owners_only") }),
  z.object({ kind: z.literal("requires"), permission: z.enum(PAGE_PERMISSION_KEYS) }),
]);

export const saveHomeTilesSchema = z.object({
  companyId: z.string().uuid(),
  tiles: z
    .array(
      z.object({
        key: z.enum(HOME_TILE_KEYS),
        visible: z.boolean(),
        order: z.number().int().min(0),
        visibility: visibilitySchema,
      }),
    )
    .length(HOME_TILE_KEYS.length)
    .refine((tiles) => new Set(tiles.map((t) => t.key)).size === tiles.length, "Each tile appears once"),
});

export type SaveHomeTilesInput = z.infer<typeof saveHomeTilesSchema>;

/** `company_home_tiles` rows for a configuration, with dense positions. */
export function toTileRows(config: readonly HomeTileConfig[]): HomeTileRow[] {
  return renumber(editColumns(config)).map((t) => ({
    tileKey: t.key,
    visible: t.visible,
    position: t.order,
    visibility: t.visibility.kind,
    requiredPermission: t.visibility.kind === "requires" ? t.visibility.permission : null,
  }));
}
