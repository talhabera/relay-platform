"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KnowledgeEntryData } from "@/components/agent/knowledge-model";
import type { LeadCapturePanelData } from "@/components/agent/lead-capture-model";
import { sourceLabel, type CanvasSource } from "@/components/v2/canvas";
import { Icon, IconButton } from "@/components/v2/primitives";

import { AddSourceDialog } from "./add-source-dialog";
import { AgentsCanvas } from "./agents-canvas";
import type { AgentsCanvasModel } from "./agents-canvas-model";
import { HandoffInspector } from "./handoff/handoff-inspector";
import { handoffNodeView, type HandoffPanelData } from "./handoff/handoff-model";
import { SourcesInspector } from "./sources-inspector";
import { TestChatPanel } from "./test-chat-panel";
import { WidgetConfigDialog } from "./widget-config-dialog";
import type { AgentsWidget } from "./widget-config-model";

type AgentsWorkspaceProps = {
  model: AgentsCanvasModel;
  companyId: string;
  /** The company's Website widget; null hides Configure widget. */
  widget: AgentsWidget | null;
  /** Owner only: bind, pause and remove sources. */
  canManage: boolean;
  /** The selected agent's Lead capture section data (null hides it). */
  leadCapture?: LeadCapturePanelData | null;
  /** The selected agent's knowledge sources (Knowledge tab). */
  knowledge?: KnowledgeEntryData[];
  /** Empty state body (Figma 07 `agents-customer/empty`), rendered when there are no agents. */
  empty?: React.ReactNode;
  /** The selected agent's human handoff (Handoff node + settings); null hides the node. */
  handoff?: HandoffPanelData | null;
  /** `?panel=handoff`: the Handoff settings inspector replaces the agent inspector. */
  panel?: "handoff";
};

/**
 * Customer Agents canvas B: the canvas, the selected agent's inspector, the Add source dialog
 * (Figma 07 `agents-customer/add-binding`) and the Website widget dialog (`widget-config`).
 * SourceNode Connect and the source menu bind the source to the selected agent.
 */
export function AgentsWorkspace({
  model,
  companyId,
  widget,
  canManage,
  leadCapture,
  knowledge,
  empty,
  handoff,
  panel,
}: AgentsWorkspaceProps) {
  const router = useRouter();
  const selection = model.selected;
  const [handoffTesting, setHandoffTesting] = React.useState(false);
  const handoffOpen = Boolean(selection && handoff && panel === "handoff");
  const [dialog, setDialog] = React.useState<{ open: boolean; source?: CanvasSource; key: number }>({
    open: false,
    key: 0,
  });
  const [widgetDialog, setWidgetDialog] = React.useState<{ open: boolean; key: number }>({ open: false, key: 0 });
  const canConfigureWidget = Boolean(canManage && selection && widget);
  const openWidgetConfig = () => setWidgetDialog((d) => ({ open: true, key: d.key + 1 }));

  function openAddSource(source?: CanvasSource) {
    if (!canManage) {
      toast.error("Only the company owner can connect sources.");
      return;
    }
    if (!selection) {
      toast.error("Create a customer agent first, then bind the source to it.");
      return;
    }
    if (source && selection.bindings.some((b) => b.source === source)) {
      toast(`${sourceLabel[source]} is paused on ${selection.name}. Resume it in the inspector.`);
      return;
    }
    setDialog((d) => ({ open: true, source, key: d.key + 1 }));
  }

  const boundTo = (source: CanvasSource) =>
    model.cards.filter((card) => card.glyphs.includes(source));

  function sourceMenu(source: CanvasSource) {
    const label = sourceLabel[source];
    const agents = boundTo(source);
    const canBind = Boolean(
      canManage && selection && selection.addOptions.some((o) => o.source === source),
    );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon="ellipsis" label={`${label} actions`} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {agents.length > 0 ? <DropdownMenuLabel>Answers through</DropdownMenuLabel> : null}
          {agents.map((card) => (
            <DropdownMenuItem key={card.agentId} asChild>
              <Link href={`/agents?agent=${card.agentId}`} scroll={false}>
                <Icon name="arrow-right" size={16} />
                {card.name}
              </Link>
            </DropdownMenuItem>
          ))}
          {source === "website" && canConfigureWidget && selection ? (
            <>
              {agents.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={openWidgetConfig}>Configure widget for {selection.name}</DropdownMenuItem>
            </>
          ) : null}
          {canBind && selection ? (
            <>
              {agents.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => openAddSource(source)}>
                Bind to {selection.name}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <div className="min-w-0 flex-1">
        <AgentsCanvas
          model={model}
          onConnectSource={openAddSource}
          sourceMenu={sourceMenu}
          empty={empty}
          handoff={
            selection && handoff
              ? { agentId: selection.agentId, view: handoffNodeView(handoff), selected: handoffOpen }
              : undefined
          }
        />
      </div>
      {selection && handoff && handoffOpen ? (
        handoffTesting ? (
          <TestChatPanel
            agentId={selection.agentId}
            agentName={selection.name}
            companyId={companyId}
            onClose={() => setHandoffTesting(false)}
          />
        ) : (
          <HandoffInspector
            key={`handoff:${selection.agentId}`}
            agentId={selection.agentId}
            agentName={selection.name}
            data={handoff}
            canManage={canManage}
            onClose={() => router.push(`/agents?agent=${selection.agentId}`, { scroll: false })}
            onTestChat={() => setHandoffTesting(true)}
          />
        )
      ) : selection ? (
        <SourcesInspector
          key={selection.agentId}
          selection={selection}
          companyId={companyId}
          canManage={canManage}
          onAddSource={() => openAddSource()}
          onConfigureWidget={canConfigureWidget ? openWidgetConfig : undefined}
          leadCapture={leadCapture}
          knowledge={knowledge}
        />
      ) : null}
      {selection && dialog.open ? (
        <AddSourceDialog
          key={dialog.key}
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          agentId={selection.agentId}
          agentName={selection.name}
          options={selection.addOptions}
          initialSource={dialog.source}
        />
      ) : null}
      {selection && widget && widgetDialog.open ? (
        <WidgetConfigDialog
          key={widgetDialog.key}
          open={widgetDialog.open}
          onOpenChange={(open) => setWidgetDialog((d) => ({ ...d, open }))}
          widget={widget}
          agentId={selection.agentId}
          agentName={selection.name}
        />
      ) : null}
    </div>
  );
}
