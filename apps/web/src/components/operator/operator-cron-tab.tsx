"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chip, Icon, Segmented, StatusChip } from "@/components/v2/primitives";
import {
  formatTimeOfDay,
  parseTimeOfDay,
  presetToScheduleFields,
  type CronPresetValue,
} from "@/lib/operator/cron-presets";
import type { CronRunStatus } from "@/lib/operator/cron-badge";
import {
  formatRunDay,
  nextRunsLabel,
  scheduleHref,
  scheduleSummary,
  timesInLabel,
  type LastRunSummary,
} from "@/lib/operator/cron-schedules";
import { CreateCronJobDialog } from "@/components/operator/create-cron-job-dialog";
import { CronJobsTable } from "@/components/operator/cron-jobs-table";
import {
  deleteCronJob,
  runCronJobNowAction,
  updateCronJob,
} from "@/app/(dashboard)/operator/cron-actions";

export type CronJobListItem = {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  versionId: string;
  prompt: string;
  enabled: boolean;
  scheduleKind: "interval" | "daily" | "weekly";
  intervalMinutes: number | null;
  weekday: number | null;
  timeOfDay: number | null;
  timezone: string;
  latestStatus: CronRunStatus | null;
  canEdit: boolean;
  versionName?: string | null;
  versionStatus?: "live" | "draft" | null;
  /** ISO; null while the schedule is paused. */
  nextFireAt?: string | null;
  lastRun?: LastRunSummary | null;
};

export type EditableAgent = {
  id: string;
  name: string;
  versions: { id: string; name: string }[];
};

type OperatorCronTabProps = {
  jobs: CronJobListItem[];
  selectedJobId: string | null;
  editableAgents: EditableAgent[];
  versionsForSelectedJob: { id: string; name: string }[];
  /** Next fire times (ISO) for the selected job, first = stored next fire. */
  nextRuns?: string[];
};

const LIST_URL = scheduleHref();

/**
 * Schedules tab (Figma 05 `schedules/default` + `schedules/editor`): one card with the
 * page head, summary chips and the Schedule row table; `jobId` opens the editor sheet.
 * Schedules only set up jobs: their runs are listed and opened from Sessions.
 */
export function OperatorCronTab({
  jobs,
  selectedJobId,
  editableAgents,
  versionsForSelectedJob,
  nextRuns = [],
}: OperatorCronTabProps) {
  const router = useRouter();
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const summary = scheduleSummary(jobs);

  async function handleDeleteJob(job: CronJobListItem) {
    if (!job.canEdit) return;
    if (!window.confirm(`Delete "${job.name}"?`)) return;

    try {
      await deleteCronJob(job.id);
      toast.success("Schedule deleted");
      if (job.id === selectedJobId) router.push(LIST_URL);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete schedule",
      );
    }
  }

  async function handleToggleEnabled(job: CronJobListItem, enabled: boolean) {
    if (!job.canEdit) return;

    try {
      await updateCronJob(job.id, { enabled });
      toast.success(enabled ? "Schedule resumed" : "Schedule paused");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update schedule",
      );
    }
  }

  return (
    <>
      <section
        aria-labelledby="schedules-title"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="schedules-title" className="type-h2 text-foreground">
              Schedules
            </h2>
            <p className="type-small text-muted-foreground">
              Scheduled jobs open sessions on their own
              {jobs.length > 0 ? ` · ${timesInLabel(jobs)}` : ""}
            </p>
          </div>
          <CreateCronJobDialog agents={editableAgents} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip asStatic variant="selected" size="md" icon="calendar-clock">
            {summary.total} {summary.total === 1 ? "schedule" : "schedules"}
          </Chip>
          {summary.paused > 0 ? (
            <Chip asStatic size="md" icon="pause">
              {summary.paused} paused
            </Chip>
          ) : null}
          <span className="min-w-0 flex-1" aria-hidden />
          {summary.failed > 0 ? (
            <StatusChip tone="error">{summary.failed} failed</StatusChip>
          ) : null}
          {summary.waiting > 0 ? (
            <StatusChip tone="needs-you">
              {summary.waiting} waiting on you
            </StatusChip>
          ) : null}
        </div>

        {!editableAgents.length ? (
          <p className="type-caption text-muted-foreground">
            You need edit access to an operator agent to create schedules.
          </p>
        ) : null}

        <CronJobsTable
          jobs={jobs}
          selectedJobId={selectedJobId}
          onToggleEnabled={handleToggleEnabled}
          onDelete={handleDeleteJob}
        />

        <div className="flex items-start gap-2">
          <Icon name="info" size={16} className="mt-px shrink-0 text-muted-foreground" />
          <p className="type-caption text-muted-foreground">
            Each run opens a session with its agent. Steps the agent marks as
            checkpoints stop for approval; everything else runs on its own.
          </p>
        </div>
      </section>

      <Sheet
        open={selectedJob !== null}
        onOpenChange={(open) => {
          if (!open) router.push(LIST_URL);
        }}
      >
        <SheetContent className="w-full gap-5 sm:max-w-[560px]">
          {selectedJob ? (
            <ScheduleEditor
              key={selectedJob.id}
              job={selectedJob}
              versions={versionsForSelectedJob}
              nextRuns={nextRuns}
              onDelete={handleDeleteJob}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

type CadenceKind = "interval" | "daily" | "weekly";

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 180, 360, 720] as const;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function intervalLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes === 60) return "Every hour";
  return `Every ${minutes / 60} hours`;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="type-label uppercase text-muted-foreground">
      {children}
    </label>
  );
}

type ScheduleEditorProps = {
  job: CronJobListItem;
  versions: { id: string; name: string }[];
  nextRuns: string[];
  onDelete: (job: CronJobListItem) => void;
};

function ScheduleEditor({
  job,
  versions,
  nextRuns,
  onDelete,
}: ScheduleEditorProps) {
  const router = useRouter();
  const readOnly = !job.canEdit;

  const initial = {
    name: job.name,
    prompt: job.prompt,
    versionId: job.versionId,
    enabled: job.enabled,
    kind: job.scheduleKind as CadenceKind,
    interval: String(job.intervalMinutes ?? 30),
    timeOfDay: formatTimeOfDay(job.timeOfDay ?? 540),
    weekday: String(job.weekday ?? 1),
    timezone: job.timezone,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [runNow, setRunNow] = useState<
    | { state: "idle" | "pending" | "queued" }
    | { state: "refused"; message: string }
  >({ state: "idle" });
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (key) => form[key] !== initial[key],
  );

  function set<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (readOnly) return;
    setSaving(true);
    try {
      const preset: CronPresetValue =
        form.kind === "interval" ? `interval:${Number(form.interval)}` : form.kind;
      const schedule = presetToScheduleFields(preset, {
        timeOfDay: parseTimeOfDay(form.timeOfDay),
        weekday: Number(form.weekday),
        timezone: form.timezone,
      });
      await updateCronJob(job.id, {
        name: form.name,
        prompt: form.prompt,
        versionId: form.versionId,
        enabled: form.enabled,
        ...schedule,
      });
      toast.success("Schedule saved");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save schedule",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (readOnly) return;
    setRunNow({ state: "pending" });
    try {
      const result = await runCronJobNowAction(job.id);
      if ("error" in result) {
        setRunNow({ state: "refused", message: result.error });
        return;
      }
      setRunNow({ state: "queued" });
      router.refresh();
    } catch (error) {
      setRunNow({
        state: "refused",
        message: error instanceof Error ? error.message : "Failed to run schedule",
      });
    }
  }

  const nextLabel = nextRunsLabel(nextRuns, job.timezone);
  const firstRun = nextRuns[0];
  const versionLabel = (v: { id: string; name: string }) => `${job.agentName} · ${v.name}`;

  return (
    <>
      <div className="flex flex-col gap-1 pr-10">
        <SheetTitle className="type-h3 text-foreground">
          {readOnly ? "Schedule" : "Edit schedule"}
        </SheetTitle>
        <SheetDescription className="type-small text-muted-foreground">
          {job.name} · opens a {job.agentName} session each run
        </SheetDescription>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
            <Input
              id="schedule-name"
              value={form.name}
              disabled={readOnly}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Agent</FieldLabel>
            <Select
              value={form.versionId}
              disabled={readOnly}
              onValueChange={(value) => set("versionId", value)}
            >
              <SelectTrigger aria-label="Agent version" className="w-full">
                <SelectValue placeholder={job.agentName} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel>Cadence</FieldLabel>
          <Segmented
            aria-label="Cadence"
            disabled={readOnly}
            items={[
              { value: "interval", label: "Interval" },
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ]}
            value={form.kind}
            onValueChange={(value) => set("kind", value as CadenceKind)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {form.kind === "interval" ? (
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel>Every</FieldLabel>
              <Select
                value={form.interval}
                disabled={readOnly}
                onValueChange={(value) => set("interval", value)}
              >
                <SelectTrigger aria-label="Interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {intervalLabel(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor="schedule-time">Time ({form.timezone})</FieldLabel>
              <Input
                id="schedule-time"
                type="time"
                value={form.timeOfDay}
                disabled={readOnly}
                onChange={(e) => set("timeOfDay", e.target.value)}
              />
              {firstRun && !dirty ? (
                <p className="type-caption text-muted-foreground">
                  Next {formatRunDay(firstRun, job.timezone)}
                </p>
              ) : null}
            </div>
          )}
          {form.kind === "weekly" ? (
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel>Day</FieldLabel>
              <Select
                value={form.weekday}
                disabled={readOnly}
                onValueChange={(value) => set("weekday", value)}
              >
                <SelectTrigger aria-label="Weekday" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor="schedule-timezone">Timezone</FieldLabel>
              <Input
                id="schedule-timezone"
                value={form.timezone}
                disabled={readOnly}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </div>
          )}
          {form.kind === "weekly" ? (
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor="schedule-timezone">Timezone</FieldLabel>
              <Input
                id="schedule-timezone"
                value={form.timezone}
                disabled={readOnly}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {nextLabel && !dirty ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="calendar-clock" size={16} />
            <p className="type-small">{nextLabel}</p>
          </div>
        ) : !job.enabled ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="pause" size={16} />
            <p className="type-small">Paused · no runs are scheduled</p>
          </div>
        ) : null}

        <Link
          href={`/operator?tab=sessions&range=all&q=${encodeURIComponent(job.name)}`}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 type-small text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Icon name="history" size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">This schedule&apos;s runs are in Sessions</span>
          <Icon name="arrow-right" size={14} />
        </Link>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="schedule-prompt">Instructions</FieldLabel>
          <Textarea
            id="schedule-prompt"
            rows={3}
            value={form.prompt}
            disabled={readOnly}
            onChange={(e) => set("prompt", e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="schedule-enabled" className="type-small text-foreground">
              Run on schedule
            </label>
            <p className="type-caption text-muted-foreground">
              Off: the schedule is paused and no sessions open
            </p>
          </div>
          <Switch
            id="schedule-enabled"
            checked={form.enabled}
            disabled={readOnly}
            onCheckedChange={(checked) => set("enabled", checked)}
          />
        </div>
      </div>

      {readOnly ? (
        <p className="type-caption text-muted-foreground">
          View only · editing needs edit access to {job.agentName}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onDelete(job)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button
              variant="outline"
              onClick={handleRunNow}
              disabled={runNow.state === "pending"}
            >
              {runNow.state === "pending" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run now
            </Button>
            <span className="flex-1" aria-hidden />
            <Button variant="ghost" asChild>
              <Link href={LIST_URL}>Cancel</Link>
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save schedule
            </Button>
          </div>
          {runNow.state === "queued" ? (
            <p role="status" className="type-caption text-muted-foreground">
              Queued, runs within a minute
            </p>
          ) : runNow.state === "refused" ? (
            <p role="alert" className="type-caption text-destructive">
              {runNow.message}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
