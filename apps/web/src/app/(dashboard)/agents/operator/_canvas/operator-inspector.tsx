"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createOperatorKnowledgeEntry,
  createOperatorKnowledgeFromWebsite,
  deleteOperatorKnowledgeEntry,
  updateOperatorKnowledgeEntry,
} from "@/app/(dashboard)/operator/knowledge-actions";
import { updateOperatorVersion } from "@/app/(dashboard)/operator/actions";
import { KnowledgeTab } from "@/components/agent/knowledge-tab";
import { AccessForm } from "@/components/operator/access-form";
import { CreateCronJobDialog } from "@/components/operator/create-cron-job-dialog";
import { ForkVersionDialog, type ForkableVersion } from "@/components/operator/fork-version-dialog";
import { PromoteVersionDialog } from "@/components/operator/promote-version-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  InspectorPanel,
  operatorToolIcon,
  ToolToggleRow,
  type OperatorInspectorTab,
} from "@/components/v2/canvas";
import { BrandGlyph, Chip, Icon, StatusChip } from "@/components/v2/primitives";
import { MODEL_KEYS, MODEL_LABELS } from "@/constants";
import { DEFAULT_TOOL_TOGGLES, normalizeToolToggles, type ToolToggles } from "@/db/schema";
import { isModelKey, type ModelKey } from "@/lib/ai/model-keys";
import { OPERATOR_TOOL_CATALOG } from "@/lib/operator/tool-catalog";
import { cn } from "@/lib/utils";

import type { OperatorInspectorData } from "./load-operator-inspector";
import { NO_SELECTION, type OperatorCanvasSelection } from "./operator-canvas-model";
import { buildAccessModel, buildScheduleTab } from "./operator-inspector-model";

type OperatorInspectorProps = {
  selection: OperatorCanvasSelection;
  /** Inspector data; null when the viewer has no operator access to this agent. */
  data: OperatorInspectorData | null;
  initialTab?: OperatorInspectorTab;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** Figma model labels read "Claude Sonnet". */
const modelLabel = (key: ModelKey) => `Claude ${MODEL_LABELS[key]}`;
const statusLabel = (status: "live" | "draft") => (status === "live" ? "Live" : "Draft");
const toolIcon = (label: string) => {
  const tool = OPERATOR_TOOL_CATALOG.find((t) => t.label === label);
  return tool ? operatorToolIcon[tool.id] : undefined;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-label text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return <p className="type-small text-muted-foreground">{children}</p>;
}

type VersionRow = NonNullable<OperatorInspectorData>["versions"][number];

/** Model select and instructions of the focused version (saved on change / Save). */
function VersionEditor({ version, canEdit }: { version: VersionRow; canEdit: boolean }) {
  const router = useRouter();
  const [model, setModel] = React.useState<ModelKey>(version.model);
  const [instructions, setInstructions] = React.useState(version.instructions ?? "");
  const [saving, setSaving] = React.useState(false);
  const dirty = instructions !== (version.instructions ?? "");

  async function save(patch: { model?: ModelKey; instructions?: string }, done: string) {
    setSaving(true);
    try {
      await updateOperatorVersion(version.id, patch);
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
      if (patch.model) setModel(version.model);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Section label="Model">
        <Select
          value={model}
          disabled={!canEdit || saving}
          onValueChange={(value) => {
            if (!isModelKey(value) || value === model) return;
            setModel(value);
            void save({ model: value }, `${version.name} now uses ${modelLabel(value)}`);
          }}
        >
          <SelectTrigger aria-label="Model" className="w-full">
            <SelectValue>{modelLabel(model)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MODEL_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {modelLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>
      {canEdit ? (
        <Section label="Instructions">
          <Textarea
            aria-label={`Instructions of ${version.name}`}
            rows={6}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Describe how this operator agent should behave..."
          />
          {dirty ? (
            <Button
              size="sm"
              className="w-fit"
              disabled={saving}
              onClick={() => save({ instructions }, `${version.name} instructions saved`)}
            >
              Save instructions
            </Button>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

/** Versions tab (07 `agents-operator/default`): Version tickets, model, connectors, Used in, tools. */
function VersionsTab({
  selection,
  data,
}: {
  selection: OperatorCanvasSelection;
  data: OperatorInspectorData | null;
}) {
  const focusRow = data?.versions.find((v) => v.id === selection.focusVersion?.id);
  return (
    <div data-slot="operator-versions-overview" className="flex flex-col gap-5">
      <Section label="Versions">
        {selection.versions.length === 0 ? (
          <p className="type-small text-muted-foreground">No versions yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {selection.versions.map((v) => (
              <Link
                key={v.id}
                href={`/agents/operator?agent=${selection.agentId}&version=${v.id}`}
                scroll={false}
                aria-current={v.focused ? "true" : undefined}
                data-focused={v.focused || undefined}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  v.focused ? "border-[1.5px] border-primary bg-primary-soft" : "border border-border bg-card hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="type-mono text-foreground">{v.name}</span>
                  <span className="min-w-0 flex-1" />
                  <StatusChip tone={v.status} className="uppercase" />
                </span>
                <span className="truncate type-body-strong text-foreground" suppressHydrationWarning>
                  {v.note ?? (v.status === "live" ? `Deployed ${shortDate(v.createdAt)}` : `${v.name} ${statusLabel(v.status)}`)}
                </span>
                {v.status === "draft" || v.note ? (
                  <span className="truncate type-caption text-muted-foreground" suppressHydrationWarning>
                    {[v.forkedFrom, shortDate(v.createdAt)].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </Section>
      {focusRow ? (
        <VersionEditor key={focusRow.id} version={focusRow} canEdit={data?.canEdit ?? false} />
      ) : (
        <Section label="Model">
          <span className="type-body text-foreground">{selection.modelLabel}</span>
        </Section>
      )}
      <Section label="Connectors">
        {selection.connectors.length === 0 ? (
          <p className="type-small text-muted-foreground">No connected connectors.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selection.connectors.map((c) => (
              <Chip key={c.name} asStatic>
                <BrandGlyph brand={c.brand} size={16} />
                {c.name}
              </Chip>
            ))}
          </div>
        )}
      </Section>
      {selection.usedIn.length > 0 ? (
        <Section label="Used in">
          <div className="flex flex-wrap gap-2">
            {selection.usedIn.map((u) => (
              <Chip key={u} asStatic icon="workflow">
                {u}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}
      <Section label="Tools">
        {selection.tools.length === 0 ? (
          <p className="type-small text-muted-foreground">No tools on.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selection.tools.map((t) => (
              <Chip key={t} asStatic icon={toolIcon(t)}>
                {t}
              </Chip>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** Tools tab (07 `agents-operator/tools`): Tool toggle rows of the focused version, saved per toggle. */
function ToolsTab({ version, canEdit }: { version: VersionRow; canEdit: boolean }) {
  const router = useRouter();
  const [toggles, setToggles] = React.useState<ToolToggles>(
    normalizeToolToggles(version.toolToggles ?? DEFAULT_TOOL_TOGGLES),
  );
  const [saving, setSaving] = React.useState(false);

  async function setTool(key: keyof ToolToggles, on: boolean) {
    const previous = toggles;
    const next = { ...toggles, [key]: on };
    setToggles(next);
    setSaving(true);
    try {
      await updateOperatorVersion(version.id, { toolToggles: next });
      router.refresh();
    } catch (error) {
      setToggles(previous);
      toast.error(error instanceof Error ? error.message : "Failed to save tools");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-slot="operator-tools" className="flex flex-col gap-2">
      <h3 className="type-label text-muted-foreground">
        Tools · {version.name} {statusLabel(version.status)}
      </h3>
      <div className="flex flex-col">
        {OPERATOR_TOOL_CATALOG.map((tool) => {
          const key = tool.id as keyof ToolToggles;
          const live = tool.status === "live" && key in toggles;
          return (
            <ToolToggleRow
              key={tool.id}
              label={tool.label}
              icon={operatorToolIcon[tool.id]}
              state={live ? (toggles[key] ? "on" : "off") : "coming-soon"}
              disabled={!canEdit || saving}
              onCheckedChange={(on) => live && setTool(key, on)}
            />
          );
        })}
      </div>
      {canEdit ? null : <ReadOnlyNote>Only the agent creator and people with Edit can change tools.</ReadOnlyNote>}
    </div>
  );
}

/** Schedules tab (07 `agents-operator/schedules`): this agent's scheduled jobs and the next run. */
function SchedulesTab({
  selection,
  data,
}: {
  selection: OperatorCanvasSelection;
  data: OperatorInspectorData;
}) {
  const { rows, nextRun } = buildScheduleTab(data.schedules);
  return (
    <div data-slot="operator-schedules" className="flex flex-col gap-5">
      <Section label={`Scheduled jobs · ${rows.length}`}>
        {rows.length === 0 ? (
          <p className="type-small text-muted-foreground">No schedules run {selection.name} yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={row.href}
                data-slot="schedule-row"
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                  <Icon name="calendar-clock" size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate type-body-strong text-foreground">{row.name}</span>
                  <span className="truncate type-caption text-muted-foreground">{row.detail}</span>
                </span>
                <StatusChip tone={row.tone} className="uppercase">
                  {row.label}
                </StatusChip>
                <Icon name="chevron-right" size={16} className="text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </Section>
      {nextRun ? (
        <Section label="Next run">
          <p className="type-body-strong text-foreground" suppressHydrationWarning>
            {nextRun}
          </p>
        </Section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {data.canEdit ? (
          <CreateCronJobDialog
            triggerVariant="outline"
            triggerSize="sm"
            agents={[
              {
                id: selection.agentId,
                name: selection.name,
                versions: data.versions.map((v) => ({ id: v.id, name: v.name })),
              },
            ]}
          />
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/operator?tab=cron">Open in Operator</Link>
        </Button>
      </div>
      <p className="type-small text-muted-foreground">
        Each run opens a session in Operator. Checkpoints in that session still wait for approval.
      </p>
    </div>
  );
}

/** Fork version + Promote vN to live (editors only). */
function VersionFooter({
  selection,
  data,
}: {
  selection: OperatorCanvasSelection;
  data: OperatorInspectorData;
}) {
  const focus = data.versions.find((v) => v.id === selection.focusVersion?.id);
  const live = data.versions.find((v) => v.status === "live");
  if (!focus) return null;

  const forkable: ForkableVersion[] = data.versions.map((v) => {
    const toggles = normalizeToolToggles(v.toolToggles);
    return {
      id: v.id,
      name: v.name,
      status: v.status,
      tools: OPERATOR_TOOL_CATALOG.filter((t) => t.id in toggles && toggles[t.id as keyof ToolToggles]).map(
        (t) => t.label,
      ),
      modelLabel: modelLabel(v.model),
    };
  });
  const pinned = live ? data.schedules.filter((s) => s.versionName === live.name).length : 0;

  return (
    <>
      <ForkVersionDialog
        agentId={selection.agentId}
        agentName={selection.name}
        versionId={live?.id ?? focus.id}
        versions={forkable}
        trigger={
          <Button variant="outline" className="min-w-0 flex-1">
            Fork version
          </Button>
        }
      />
      {focus.status === "draft" && live ? (
        <PromoteVersionDialog
          agentName={selection.name}
          from={{ id: live.id, name: live.name, instructions: live.instructions }}
          to={{ id: focus.id, name: focus.name, instructions: focus.instructions }}
          pinnedSchedules={pinned}
          trigger={<Button className="min-w-0 flex-1">Promote {focus.name} to live</Button>}
        />
      ) : (
        <Button className="min-w-0 flex-1" disabled>
          {focus.name} is live
        </Button>
      )}
    </>
  );
}

/**
 * Operator inspector (Figma 07 `agents-operator/*`): Versions (tickets, model, instructions),
 * Tools (toggle rows), Schedules (this agent's jobs), Access (Edit / Approve per agent user,
 * replaces Editors) and Knowledge. Footer: Fork version and Promote to live for editors.
 */
export function OperatorInspector({ selection, data, initialTab = "versions" }: OperatorInspectorProps) {
  const router = useRouter();
  const [tab, setTab] = React.useState<OperatorInspectorTab>(initialTab);
  const focus = selection.focusVersion;
  const focusRow = data?.versions.find((v) => v.id === focus?.id);
  const canEdit = data?.canEdit ?? false;
  const noAccess = <ReadOnlyNote>You don&apos;t have Operator access to {selection.name}.</ReadOnlyNote>;

  return (
    <InspectorPanel
      kind="operator"
      name={selection.name}
      description={selection.description}
      version={focus?.name}
      versionStatus={focus?.status}
      tab={tab}
      onTabChange={(next) => setTab(next as OperatorInspectorTab)}
      onClose={() => router.push(`/agents/operator?agent=${NO_SELECTION}`, { scroll: false })}
      footer={data && canEdit ? <VersionFooter selection={selection} data={data} /> : undefined}
      className="w-full lg:w-[440px] lg:self-stretch [&>[data-slot=inspector-content]]:flex-1"
    >
      {tab === "versions" ? (
        <VersionsTab selection={selection} data={data} />
      ) : tab === "tools" ? (
        focusRow ? (
          <ToolsTab key={focusRow.id} version={focusRow} canEdit={canEdit} />
        ) : (
          noAccess
        )
      ) : tab === "schedules" ? (
        data ? (
          <SchedulesTab selection={selection} data={data} />
        ) : (
          noAccess
        )
      ) : tab === "access" ? (
        data ? (
          <AccessForm agentId={selection.agentId} agentName={selection.name} model={buildAccessModel(data.access)} />
        ) : (
          noAccess
        )
      ) : data && canEdit ? (
        <KnowledgeTab
          agentId={selection.agentId}
          agentName={selection.name}
          kind="operator"
          companyId={data.companyId}
          entries={data.knowledgeEntries}
          createEntry={createOperatorKnowledgeEntry}
          createFromWebsite={createOperatorKnowledgeFromWebsite}
          updateEntry={updateOperatorKnowledgeEntry}
          deleteEntry={deleteOperatorKnowledgeEntry}
        />
      ) : (
        <ReadOnlyNote>Only the agent creator and people with Edit can change {selection.name}.</ReadOnlyNote>
      )}
    </InspectorPanel>
  );
}
