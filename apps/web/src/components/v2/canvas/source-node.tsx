import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BrandGlyph } from "../primitives/brand-glyph";
import { IconButton } from "../primitives/icon-button";
import { CanvasPort, type CanvasPortTone } from "./canvas-port";

/** Customer sources (Shopify and Zendesk are integrations, not sources). */
type CanvasSource = "website" | "whatsapp" | "instagram" | "messenger" | "telegram";
type SourceNodeState = "connected" | "disconnected" | "error";

const sourceLabel: Record<CanvasSource, string> = {
  website: "Website widget",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
};

function defaultStatusText(source: CanvasSource, state: SourceNodeState): string {
  if (state === "connected") return "Connected";
  if (state === "disconnected") return "Not connected";
  return source === "website" ? "Embed missing" : "Token expired";
}

const dotClass: Record<SourceNodeState, string> = {
  connected: "bg-success",
  disconnected: "bg-muted-foreground",
  error: "bg-destructive",
};

const portTone: Record<SourceNodeState, CanvasPortTone> = {
  connected: "active",
  disconnected: "idle",
  error: "error",
};

type SourceNodeProps = Omit<React.ComponentProps<"div">, "children"> & {
  source: CanvasSource;
  state?: SourceNodeState;
  /** Defaults to the source's label (e.g. "Website widget"). */
  name?: string;
  /** Defaults per state: Connected | Not connected | Token expired (Embed missing for website). */
  statusText?: string;
  /** Connect (disconnected) / Reconnect (error) action. */
  onConnect?: () => void;
  /** Menu in state connected. undefined renders the default ellipsis IconButton; null hides it. */
  menu?: React.ReactNode;
};

/**
 * Figma `Source node` (02 `375:24280`): 300 wide customer source on the Agents canvas.
 * source website | whatsapp | instagram | messenger | telegram x state connected (teal port)
 * | disconnected (Connect) | error (Reconnect). Right port feeds customer agent cards only.
 */
function SourceNode({
  className,
  source,
  state = "connected",
  name,
  statusText,
  onConnect,
  menu,
  ...props
}: SourceNodeProps) {
  const label = name ?? sourceLabel[source];
  return (
    <div
      data-slot="source-node"
      data-source={source}
      data-state={state}
      className={cn(
        "relative flex w-[300px] max-w-full items-center gap-3 rounded-xl bg-card p-4 shadow-elevation-1",
        state === "error" ? "border-[1.5px] border-destructive" : "border border-border",
        className,
      )}
      {...props}
    >
      <BrandGlyph brand={source} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate type-body-strong text-foreground">{label}</span>
        <span className="flex items-center gap-2">
          <span data-slot="source-node-dot" aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass[state])} />
          <span className="truncate type-caption text-muted-foreground">
            {statusText ?? defaultStatusText(source, state)}
          </span>
        </span>
      </div>
      {state === "connected" ? (
        menu === undefined ? (
          <IconButton icon="ellipsis" label={`${label} actions`} size="sm" />
        ) : (
          menu
        )
      ) : (
        <Button variant="outline" size="md" onClick={onConnect}>
          {state === "error" ? "Reconnect" : "Connect"}
        </Button>
      )}
      <CanvasPort side="right" tone={portTone[state]} />
    </div>
  );
}

export { SourceNode, sourceLabel };
export type { CanvasSource, SourceNodeProps, SourceNodeState };
