"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteChannel, updateAgent, updateChannel } from "@/app/(dashboard)/agents/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IntakeEditor } from "@/components/agent/intake-editor";
import type { KnowledgeEntryData } from "@/components/agent/knowledge-model";
import { KnowledgeTab } from "@/components/agent/knowledge-tab";
import type { LeadCapturePanelData } from "@/components/agent/lead-capture-model";
import { LeadCaptureSection } from "@/components/agent/lead-capture-section";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BindingRow, InspectorPanel, sourceLabel, type CustomerInspectorTab } from "@/components/v2/canvas";
import { IconButton } from "@/components/v2/primitives";

import { NO_SELECTION, type AgentsCanvasBinding, type AgentsCanvasSelection } from "./agents-canvas-model";
import { canSaveInstructions } from "./inspector-model";
import { InstructionsSection, IntegrationsSection } from "./inspector-tabs";
import { TestChatPanel } from "./test-chat-panel";

type SourcesInspectorProps = {
  selection: AgentsCanvasSelection;
  companyId: string;
  /** Owner only: bind, pause and remove sources, edit instructions and integrations. */
  canManage: boolean;
  onAddSource: () => void;
  /** Owner only: opens the Website widget dialog from the widget binding menu. */
  onConfigureWidget?: () => void;
  /** First tab shown (default Sources). */
  initialTab?: CustomerInspectorTab;
  /** Lead capture group under Bound sources (Figma 07 `lead-capture-*`); omitted hides it. */
  leadCapture?: LeadCapturePanelData | null;
  /** Knowledge tab sources (Figma 07 `knowledge*`). */
  knowledge?: KnowledgeEntryData[];
};

const SECTION_LABEL: Partial<Record<CustomerInspectorTab, string>> = {
  sources: "Bound sources",
  instructions: "Instructions",
  integrations: "Integrations",
};

/**
 * Customer inspector (Figma 07 `agents-customer/default` 411:27660, `instructions` 411:31861,
 * `integrations` 411:37385, `test-chat` 411:31965): Sources, Instructions, Knowledge and
 * Integrations tabs, with the Lead capture group under Sources (`lead-capture-on` 698:88502, `off`
 * 708:95861) whose Edit intake swaps the panel for the intake editor; footer Test chat swaps the panel for the Chat dock, Save changes saves the
 * instructions. Bindings and integration toggles save as they change.
 */
export function SourcesInspector({
  selection,
  companyId,
  canManage,
  onAddSource,
  onConfigureWidget,
  initialTab = "sources",
  leadCapture,
  knowledge = [],
}: SourcesInspectorProps) {
  const router = useRouter();
  const [tab, setTab] = React.useState<CustomerInspectorTab>(initialTab);
  const [testing, setTesting] = React.useState(false);
  const [editingIntake, setEditingIntake] = React.useState(false);
  const [draft, setDraft] = React.useState(selection.instructions);
  const [saving, startSaving] = React.useTransition();
  const canSave = tab === "instructions" && canSaveInstructions(selection.instructions, draft, canManage);

  function saveInstructions() {
    startSaving(async () => {
      try {
        await updateAgent(selection.agentId, { instructions: draft });
        toast.success("Instructions saved");
        router.refresh();
      } catch {
        toast.error("Could not save the instructions");
      }
    });
  }

  if (testing) {
    return (
      <TestChatPanel
        agentId={selection.agentId}
        agentName={selection.name}
        companyId={companyId}
        onClose={() => setTesting(false)}
      />
    );
  }

  const leadWorkflow = leadCapture?.workflows.find((w) => w.id === leadCapture.workflowId);
  if (editingIntake && leadCapture && leadWorkflow) {
    return (
      <IntakeEditor
        agentId={selection.agentId}
        workflowName={leadWorkflow.name}
        sharedBy={leadWorkflow.sharedBy}
        intake={leadCapture.intake}
        onClose={() => setEditingIntake(false)}
      />
    );
  }

  return (
    <InspectorPanel
      kind="customer"
      name={selection.name}
      description={[selection.description, selection.modelLabel].filter(Boolean).join(" ")}
      status={selection.isActive ? { tone: "live", label: "Live" } : { tone: "neutral", label: "Paused" }}
      tab={tab}
      onTabChange={(next) => setTab(next as CustomerInspectorTab)}
      sectionLabel={SECTION_LABEL[tab]}
      onClose={() => router.push(`/agents?agent=${NO_SELECTION}`, { scroll: false })}
      secondaryAction={{ label: "Test chat", onClick: () => setTesting(true) }}
      primaryAction={{ label: "Save changes", onClick: saveInstructions, disabled: !canSave || saving }}
      className="w-full lg:w-[400px] lg:self-stretch [&>[data-slot=inspector-content]]:flex-1"
    >
      {tab === "sources" ? (
        <div data-slot="inspector-sources" className="flex flex-col gap-2 pt-2">
          {selection.bindings.length === 0 ? (
            <p className="type-small text-muted-foreground">
              No sources yet. Add one so customers can reach {selection.name}.
            </p>
          ) : (
            selection.bindings.map((binding) => (
              <BindingRow
                key={binding.channelId}
                source={binding.source}
                status={binding.status}
                menu={
                  canManage ? (
                    <BindingMenu
                      binding={binding}
                      agentName={selection.name}
                      onConfigureWidget={binding.source === "website" ? onConfigureWidget : undefined}
                    />
                  ) : null
                }
              />
            ))
          )}
          {canManage ? (
            <Button
              variant="outline"
              size="md"
              className="w-full"
              onClick={onAddSource}
              disabled={selection.addOptions.length === 0}
            >
              Add source
            </Button>
          ) : null}
          {leadCapture ? (
            <LeadCaptureSection
              key={`${leadCapture.enabled}:${leadCapture.workflowId}`}
              agentId={selection.agentId}
              data={leadCapture}
              canManage={canManage}
              onEditIntake={() => setEditingIntake(true)}
            />
          ) : null}
        </div>
      ) : tab === "instructions" ? (
        <InstructionsSection selection={selection} draft={draft} onDraftChange={setDraft} canManage={canManage} />
      ) : tab === "integrations" ? (
        <IntegrationsSection selection={selection} companyId={companyId} canManage={canManage} />
      ) : (
        <KnowledgeTab
          agentId={selection.agentId}
          companyId={companyId}
          agentName={selection.name}
          kind="customer"
          entries={knowledge}
          canManage={canManage}
          className="pt-0"
        />
      )}
    </InspectorPanel>
  );
}

function BindingMenu({
  binding,
  agentName,
  onConfigureWidget,
}: {
  binding: AgentsCanvasBinding;
  agentName: string;
  onConfigureWidget?: () => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const label = sourceLabel[binding.source];
  const live = binding.status === "live";

  function run(task: () => Promise<void>, done: string, failed: string) {
    startTransition(async () => {
      try {
        await task();
        toast.success(done);
        router.refresh();
      } catch {
        toast.error(failed);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon="ellipsis" label={`${label} binding actions`} size="sm" disabled={pending} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onConfigureWidget ? (
            <DropdownMenuItem onSelect={onConfigureWidget}>Configure widget</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() =>
              run(
                () => updateChannel(binding.channelId, { status: live ? "inactive" : "active" }),
                live ? `${label} paused` : `${label} is live`,
                `Could not update ${label}`,
              )
            }
          >
            {live ? "Pause" : "Resume"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {label} stops answering through {agentName}. Its credentials are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() =>
                run(() => deleteChannel(binding.channelId), `${label} removed`, `Could not remove ${label}`)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
