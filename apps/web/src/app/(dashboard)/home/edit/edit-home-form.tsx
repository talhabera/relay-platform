"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Icon, type IconName, Segmented, StatusChip } from "@/components/v2/primitives";
import type { HomeTileKey } from "@relay/db/schema";
import type { HomeTileConfig } from "@/lib/fixtures/interfaces";
import { cn } from "@/lib/utils";

import { DEFAULT_HOME_TILES, HOME_TILE_LABEL, type HomeColumn } from "../_home/tiles";
import { saveHomeTiles } from "./actions";
import {
  HOME_COLUMNS,
  HOME_COLUMN_COPY,
  HOME_TILE_DESCRIPTION,
  VISIBILITY_OPTIONS,
  editColumns,
  moveTile,
  parseVisibilityValue,
  previewColumns,
  sameConfig,
  updateTile,
  visibilityValue,
  type PreviewMode,
} from "./edit-model";

/** Same card as `_home/home-view` `tileClass`; kept local so this client file does not import the server view. */
const tileClass = "flex flex-col rounded-2xl border border-border bg-card shadow-elevation-1";

const TILE_ICON: Record<HomeTileKey, IconName> = {
  daily_brief: "list-checks",
  my_tasks: "clipboard-check",
  ad_report: "chart-no-axes-column",
  goal_strip: "target",
  agent_map: "workflow",
  needs_you: "bell",
  today: "calendar",
  lead_engine: "magnet",
};

type EditHomeFormProps = {
  companyId: string;
  companyName: string;
  initialTiles: HomeTileConfig[];
};

/** Figma 04 `home/edit`: per-column tile lists on the left, Owner/Member preview on the right. */
export function EditHomeForm({ companyId, companyName, initialTiles }: EditHomeFormProps) {
  const router = useRouter();
  const [tiles, setTiles] = React.useState<HomeTileConfig[]>(initialTiles);
  const [preview, setPreview] = React.useState<PreviewMode>("owner");
  const [dragging, setDragging] = React.useState<HomeTileKey | null>(null);
  const [pending, startTransition] = React.useTransition();

  const columns = editColumns(tiles);
  const dirty = !sameConfig(tiles, initialTiles);
  const isDefault = sameConfig(tiles, DEFAULT_HOME_TILES);

  function save() {
    startTransition(async () => {
      try {
        await saveHomeTiles({ companyId, tiles });
        toast.success("Home saved");
        router.push("/home");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save Home");
      }
    });
  }

  return (
    <div data-slot="home-edit" className="flex flex-col gap-6 pt-2 pb-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-h1 text-foreground">Edit Home</h1>
            <p className="type-small text-muted-foreground">
              Choose which Home tiles {companyName} sees, their order and who can see each one.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              disabled={pending || isDefault}
              onClick={() => setTiles(DEFAULT_HOME_TILES.map((t) => ({ ...t })))}
            >
              <Icon name="undo-2" size={16} />
              Reset to default
            </Button>
            <Link href="/home" className={buttonVariants({ variant: "outline" })} aria-disabled={pending}>
              Cancel
            </Link>
            <Button disabled={pending || !dirty} onClick={save}>
              <Icon name={pending ? "loader-circle" : "check"} size={16} className={pending ? "animate-spin" : undefined} />
              Save Home
            </Button>
          </div>
        </div>

        {HOME_COLUMNS.map((column) => (
          <ColumnCard
            key={column}
            column={column}
            tiles={columns[column]}
            dragging={dragging}
            onDragStart={setDragging}
            onDragEnd={() => setDragging(null)}
            onMove={(key, toIndex) => setTiles((current) => moveTile(current, key, toIndex))}
            onChange={(key, patch) => setTiles((current) => updateTile(current, key, patch))}
            disabled={pending}
          />
        ))}

        <p className="flex items-center gap-2 type-small text-muted-foreground">
          <Icon name="info" size={16} className="shrink-0" />
          Drag a tile to reorder it within its column. Changes apply to everyone in {companyName} once you save.
        </p>
      </div>

      <PreviewCard tiles={tiles} mode={preview} onModeChange={setPreview} />
    </div>
  );
}

// ---------------------------------------------------------------------------

type ColumnCardProps = {
  column: HomeColumn;
  tiles: HomeTileConfig[];
  dragging: HomeTileKey | null;
  onDragStart: (key: HomeTileKey) => void;
  onDragEnd: () => void;
  onMove: (key: HomeTileKey, toIndex: number) => void;
  onChange: (key: HomeTileKey, patch: Partial<Pick<HomeTileConfig, "visible" | "visibility">>) => void;
  disabled: boolean;
};

function ColumnCard({ column, tiles, dragging, onDragStart, onDragEnd, onMove, onChange, disabled }: ColumnCardProps) {
  const copy = HOME_COLUMN_COPY[column];
  const titleId = `home-edit-${column}-title`;
  const ownsDrag = dragging != null && tiles.some((t) => t.key === dragging);
  return (
    <section data-slot={`home-edit-${column}`} aria-labelledby={titleId} className={cn(tileClass, "gap-2 p-4")}>
      <header className="flex items-baseline gap-2">
        <h2 id={titleId} className="type-h3 text-foreground">
          {copy.title}
        </h2>
        <span className="type-caption text-muted-foreground">{copy.hint}</span>
      </header>
      <div className="hidden grid-cols-[1fr_15rem_3rem] gap-4 border-b border-border pb-2 type-caption text-muted-foreground uppercase sm:grid">
        <span>Tile</span>
        <span>Who sees it</span>
        <span className="text-right">Show</span>
      </div>
      <ul className="flex flex-col">
        {tiles.map((tile, index) => (
          <TileRow
            key={tile.key}
            tile={tile}
            index={index}
            count={tiles.length}
            dragging={dragging === tile.key}
            onDragStart={() => onDragStart(tile.key)}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
              if (!ownsDrag || dragging === tile.key || dragging == null) return;
              event.preventDefault();
              onMove(dragging, index);
            }}
            onMove={(toIndex) => onMove(tile.key, toIndex)}
            onChange={(patch) => onChange(tile.key, patch)}
            disabled={disabled}
          />
        ))}
      </ul>
    </section>
  );
}

type TileRowProps = {
  tile: HomeTileConfig;
  index: number;
  count: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onMove: (toIndex: number) => void;
  onChange: (patch: Partial<Pick<HomeTileConfig, "visible" | "visibility">>) => void;
  disabled: boolean;
};

function TileRow({
  tile,
  index,
  count,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onMove,
  onChange,
  disabled,
}: TileRowProps) {
  const label = HOME_TILE_LABEL[tile.key];
  const hidden = !tile.visible;
  return (
    <li
      data-slot="home-edit-tile"
      data-tile={tile.key}
      data-state={hidden ? "hidden" : "shown"}
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tile.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={(event) => event.preventDefault()}
      className={cn(
        "grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-b border-border py-3 last:border-b-0 sm:grid-cols-[auto_1fr_15rem_3rem] sm:gap-x-4",
        dragging && "opacity-50",
      )}
    >
      <div className={cn("flex items-center gap-3", hidden && "opacity-50")}>
        <button
          type="button"
          aria-label={`Reorder ${label}. Use arrow keys to move it`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && index > 0) {
              event.preventDefault();
              onMove(index - 1);
            } else if (event.key === "ArrowDown" && index < count - 1) {
              event.preventDefault();
              onMove(index + 1);
            }
          }}
          className="flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <Icon name="grip-vertical" size={16} />
        </button>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <Icon name={TILE_ICON[tile.key]} size={16} />
        </span>
      </div>
      <div className={cn("flex min-w-0 flex-col", hidden && "opacity-50")}>
        <span className="flex items-center gap-2">
          <span className="truncate type-body-strong text-foreground">{label}</span>
          {hidden ? (
            <StatusChip tone="neutral" className="uppercase">
              Hidden
            </StatusChip>
          ) : null}
        </span>
        <span className="truncate type-caption text-muted-foreground">{HOME_TILE_DESCRIPTION[tile.key]}</span>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:contents">
        <Select
          value={visibilityValue(tile.visibility)}
          onValueChange={(value) => onChange({ visibility: parseVisibilityValue(value) })}
          disabled={disabled}
        >
          <SelectTrigger size="sm" className="w-full sm:w-60" aria-label={`Who sees ${label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end">
          <Switch
            checked={tile.visible}
            onCheckedChange={(visible) => onChange({ visible })}
            disabled={disabled}
            aria-label={`Show ${label}`}
          />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function PreviewCard({
  tiles,
  mode,
  onModeChange,
}: {
  tiles: HomeTileConfig[];
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}) {
  const columns = previewColumns(tiles, mode);
  return (
    <aside
      data-slot="home-edit-preview"
      aria-labelledby="home-edit-preview-title"
      className={cn(tileClass, "w-full gap-3 p-4 lg:sticky lg:top-4 lg:w-100 lg:shrink-0")}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="home-edit-preview-title" className="type-h3 text-foreground">
          Preview
        </h2>
        <Segmented
          aria-label="Preview as"
          items={[
            { value: "owner", label: "Owner" },
            { value: "member", label: "Member" },
          ]}
          value={mode}
          onValueChange={(value) => onModeChange(value === "member" ? "member" : "owner")}
        />
      </header>
      <p className="type-caption text-muted-foreground">
        {mode === "owner"
          ? "What an owner sees on Home after Save."
          : "What a member without page permissions sees on Home after Save."}
      </p>
      <div data-slot="home-edit-preview-canvas" className="grid grid-cols-[3fr_2fr] gap-2 rounded-xl bg-muted p-2">
        {(["main", "side"] as const).map((column) => (
          <div key={column} className="flex min-w-0 flex-col gap-2">
            {columns[column].length === 0 ? (
              <span className="rounded-md border border-dashed border-border p-2 type-caption text-muted-foreground">
                No tiles
              </span>
            ) : (
              columns[column].map(({ key, hidden }) => (
                <span
                  key={key}
                  data-tile={key}
                  data-state={hidden ? "hidden" : "shown"}
                  className={cn(
                    "truncate rounded-md p-2 type-caption",
                    hidden
                      ? "border border-dashed border-border text-muted-foreground"
                      : "bg-card text-foreground shadow-elevation-1",
                    key === "agent_map" && !hidden && "min-h-24",
                    key === "needs_you" && !hidden && "min-h-10",
                  )}
                >
                  {HOME_TILE_LABEL[key]}
                  {hidden ? " · hidden" : null}
                </span>
              ))
            )}
          </div>
        ))}
      </div>
      <p className="type-caption text-muted-foreground">
        Members see only the tiles they qualify for. A member without Operator access does not see tiles that require
        it, and nobody but owners sees owner-only tiles. Home itself is never gated.
      </p>
    </aside>
  );
}
