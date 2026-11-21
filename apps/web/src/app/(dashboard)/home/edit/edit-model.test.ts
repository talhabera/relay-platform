import { describe, expect, it } from "vitest";

import type { HomeTileConfig } from "@/lib/fixtures/interfaces";

import { DEFAULT_HOME_TILES, resolveHomeTiles } from "../_home/tiles";
import {
  HOME_TILE_DESCRIPTION,
  VISIBILITY_OPTIONS,
  editColumns,
  moveTile,
  parseVisibilityValue,
  previewColumns,
  sameConfig,
  saveHomeTilesSchema,
  toTileRows,
  updateTile,
  visibilityLabel,
  visibilityValue,
} from "./edit-model";

const defaults = (): HomeTileConfig[] => DEFAULT_HOME_TILES.map((t) => ({ ...t }));
const keys = (tiles: { key: string }[]) => tiles.map((t) => t.key);
const COMPANY = "00000000-0000-4000-8000-000000000001";

describe("editColumns", () => {
  it("splits the default arrangement into the Figma columns", () => {
    const c = editColumns(defaults());
    expect(keys(c.main)).toEqual(["daily_brief", "ad_report", "goal_strip", "agent_map"]);
    expect(keys(c.side)).toEqual(["my_tasks", "needs_you", "today", "lead_engine"]);
  });
});

describe("moveTile", () => {
  it("reorders within the tile's column and renumbers densely", () => {
    const next = moveTile(defaults(), "lead_engine", 0);
    expect(keys(editColumns(next).side)).toEqual(["lead_engine", "my_tasks", "needs_you", "today"]);
    expect(keys(editColumns(next).main)).toEqual(["daily_brief", "ad_report", "goal_strip", "agent_map"]);
    expect(next.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("clamps out-of-range targets and never changes column", () => {
    const next = moveTile(defaults(), "goal_strip", 99);
    expect(keys(editColumns(next).main)).toEqual(["daily_brief", "ad_report", "agent_map", "goal_strip"]);
    expect(keys(editColumns(moveTile(defaults(), "daily_brief", 3)).main)).toEqual([
      "ad_report",
      "goal_strip",
      "agent_map",
      "daily_brief",
    ]);
    expect(keys(editColumns(moveTile(defaults(), "today", -3)).side)).toEqual([
      "today",
      "my_tasks",
      "needs_you",
      "lead_engine",
    ]);
  });
});

describe("visibility values", () => {
  it("round-trips every Select option", () => {
    for (const option of VISIBILITY_OPTIONS) {
      expect(visibilityValue(parseVisibilityValue(option.value))).toBe(option.value);
    }
  });

  it("falls back to everyone for unknown values", () => {
    expect(parseVisibilityValue("requires:chat")).toEqual({ kind: "everyone" });
  });

  it("labels permissions the way the nav names them", () => {
    expect(visibilityLabel({ kind: "requires", permission: "messaging" })).toBe("Requires Inbox access");
    expect(visibilityLabel({ kind: "owners_only" })).toBe("Owners only");
  });
});

describe("previewColumns", () => {
  const edited = () => {
    let c = updateTile(defaults(), "today", { visible: false });
    c = updateTile(c, "agent_map", { visibility: { kind: "requires", permission: "operator" } });
    c = updateTile(c, "lead_engine", { visibility: { kind: "owners_only" } });
    return c;
  };

  it("owner preview shows every tile and marks hidden ones", () => {
    const p = previewColumns(edited(), "owner");
    expect(p.main).toEqual([
      { key: "daily_brief", hidden: false },
      { key: "ad_report", hidden: false },
      { key: "goal_strip", hidden: false },
      { key: "agent_map", hidden: false },
    ]);
    expect(p.side.find((t) => t.key === "today")).toEqual({ key: "today", hidden: true });
  });

  it("member preview drops hidden, permission-gated and owner-only tiles", () => {
    const p = previewColumns(edited(), "member");
    expect(keys(p.main)).toEqual(["daily_brief", "goal_strip"]);
    expect(keys(p.side)).toEqual(["needs_you"]);
  });
});

describe("sameConfig", () => {
  it("ignores sparse orders but sees real changes", () => {
    const sparse = defaults().map((t) => ({ ...t, order: t.order * 10 }));
    expect(sameConfig(sparse, defaults())).toBe(true);
    expect(sameConfig(updateTile(defaults(), "today", { visible: false }), defaults())).toBe(false);
    expect(sameConfig(moveTile(defaults(), "today", 0), defaults())).toBe(false);
  });
});

describe("toTileRows", () => {
  it("writes rows that resolve back to the same configuration", () => {
    const config = updateTile(moveTile(defaults(), "lead_engine", 0), "agent_map", {
      visible: false,
      visibility: { kind: "requires", permission: "analytics" },
    });
    const rows = toTileRows(config);
    expect(rows.find((r) => r.tileKey === "agent_map")).toMatchObject({
      visible: false,
      visibility: "requires",
      requiredPermission: "analytics",
    });
    expect(rows.find((r) => r.tileKey === "goal_strip")?.requiredPermission).toBeNull();
    expect(sameConfig(resolveHomeTiles(rows), config)).toBe(true);
  });
});

describe("my_tasks tile", () => {
  it("defaults to visible, requires Operator, and sits in the side column after Daily brief", () => {
    const tile = defaults().find((t) => t.key === "my_tasks");
    expect(tile).toEqual({
      key: "my_tasks",
      visible: true,
      order: 2,
      visibility: { kind: "requires", permission: "operator" },
    });
    expect(keys(editColumns(defaults()).side)[0]).toBe("my_tasks");
    // Member preview (no permissions) drops it; owner preview keeps it.
    expect(keys(previewColumns(defaults(), "member").side)).not.toContain("my_tasks");
    expect(keys(previewColumns(defaults(), "owner").side)).toContain("my_tasks");
  });

  it("can be hidden and moved within the side column", () => {
    const hidden = updateTile(defaults(), "my_tasks", { visible: false });
    expect(previewColumns(hidden, "owner").side.find((t) => t.key === "my_tasks")).toEqual({
      key: "my_tasks",
      hidden: true,
    });
    const moved = moveTile(defaults(), "my_tasks", 2);
    expect(keys(editColumns(moved).side)).toEqual(["needs_you", "today", "my_tasks", "lead_engine"]);
    expect(keys(editColumns(moved).main)).toEqual(["daily_brief", "ad_report", "goal_strip", "agent_map"]);
  });

  it("writes a requires:operator row that resolves back", () => {
    const rows = toTileRows(defaults());
    expect(rows.find((r) => r.tileKey === "my_tasks")).toMatchObject({
      visible: true,
      visibility: "requires",
      requiredPermission: "operator",
    });
    expect(sameConfig(resolveHomeTiles(rows), defaults())).toBe(true);
  });
});

describe("ad_report tile", () => {
  it("has a description and defaults to owners only, right after Daily brief in main", () => {
    expect(HOME_TILE_DESCRIPTION.ad_report).toMatch(/ad spend/);
    expect(defaults().find((t) => t.key === "ad_report")).toEqual({
      key: "ad_report",
      visible: true,
      order: 1,
      visibility: { kind: "owners_only" },
    });
    expect(keys(editColumns(defaults()).main).slice(0, 2)).toEqual(["daily_brief", "ad_report"]);
  });

  it("is in the owner preview and not in the member preview", () => {
    expect(keys(previewColumns(defaults(), "member").main)).not.toContain("ad_report");
    expect(previewColumns(defaults(), "owner").main).toContainEqual({ key: "ad_report", hidden: false });
  });

  it("round-trips owners_only through the save payload", () => {
    const rows = toTileRows(defaults());
    expect(rows.find((r) => r.tileKey === "ad_report")).toMatchObject({
      visible: true,
      visibility: "owners_only",
      requiredPermission: null,
    });
    expect(sameConfig(resolveHomeTiles(rows), defaults())).toBe(true);
    expect(saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles: defaults() }).success).toBe(true);
  });
});

describe("saveHomeTilesSchema", () => {
  it("accepts the full catalog, Daily brief and My tasks included", () => {
    expect(defaults().map((t) => t.key)).toContain("daily_brief");
    expect(defaults().map((t) => t.key)).toContain("my_tasks");
    expect(saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles: defaults() }).success).toBe(true);
  });

  it("rejects missing, duplicated or unknown tiles", () => {
    const d = defaults();
    expect(saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles: d.slice(1) }).success).toBe(false);
    expect(saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles: [...d.slice(1), d[1]] }).success).toBe(false);
    expect(
      saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles: [...d.slice(1), { ...d[0], key: "chat" }] }).success,
    ).toBe(false);
  });

  it("rejects a requires visibility without a valid permission", () => {
    const tiles = defaults().map((t, i) => (i === 0 ? { ...t, visibility: { kind: "requires", permission: "chat" } } : t));
    expect(saveHomeTilesSchema.safeParse({ companyId: COMPANY, tiles }).success).toBe(false);
  });
});
