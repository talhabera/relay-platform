"use client";

import Link from "next/link";
import { ScheduleRow } from "@/components/v2/work";
import { IconButton } from "@/components/v2/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatCadence,
  formatRunTime,
  lastRunNote,
  lastRunResult,
  promptSummary,
  runHref,
  scheduleHref,
} from "@/lib/operator/cron-schedules";
import type { CronJobListItem } from "@/components/operator/operator-cron-tab";

type CronJobsTableProps = {
  jobs: CronJobListItem[];
  selectedJobId: string | null;
  onToggleEnabled: (job: CronJobListItem, enabled: boolean) => void;
  onDelete: (job: CronJobListItem) => void;
};

const HEAD = "type-label uppercase text-muted-foreground";

/**
 * Figma 05 `schedules/default` table: Schedule row (density=default) per job, with the
 * `last run link` on. Rows link to the editor sheet; the last run link opens its transcript.
 */
export function CronJobsTable({
  jobs,
  selectedJobId,
  onToggleEnabled,
  onDelete,
}: CronJobsTableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border">
      <div className="min-w-[1180px]">
        <div
          role="row"
          className="flex items-center gap-4 border-b border-border bg-muted px-4 py-3"
        >
          <span className={`${HEAD} min-w-0 flex-1`}>Schedule</span>
          <span className={`${HEAD} w-61 shrink-0`}>Agent</span>
          <span className={`${HEAD} w-37.5 shrink-0`}>Cadence</span>
          <span className={`${HEAD} w-37.5 shrink-0`}>Next run</span>
          <span className={`${HEAD} w-62.5 shrink-0`}>Last run</span>
          <span className={`${HEAD} w-37.5 shrink-0`}>Needs approval</span>
          <span className="w-8 shrink-0" aria-hidden />
        </div>
        {jobs.length === 0 ? (
          <p className="px-4 py-10 text-center type-small text-muted-foreground">
            No schedules yet. Create one to run an operator agent on its own.
          </p>
        ) : (
          jobs.map((job, index) => {
            const result = lastRunResult(job.latestStatus);
            const lastRun = job.lastRun ?? null;
            return (
              <ScheduleRow
                key={job.id}
                className={
                  (index === jobs.length - 1 ? "border-b-0 " : "") +
                  (job.id === selectedJobId ? "bg-accent" : "")
                }
                name={job.name}
                nameHref={scheduleHref(job.id)}
                workflow={promptSummary(job.prompt)}
                agent={{
                  name: job.agentName,
                  version: job.versionName ?? undefined,
                  status: job.versionStatus ?? "none",
                }}
                cadence={formatCadence(job)}
                nextRun={
                  job.nextFireAt
                    ? formatRunTime(job.nextFireAt, job.timezone)
                    : "Paused"
                }
                lastResult={result?.result ?? null}
                lastResultLabel={result?.label}
                resultNote={lastRunNote(lastRun, job.timezone)}
                lastRunHref={lastRun ? runHref(lastRun.id) : undefined}
                approval="Agent checkpoints"
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        icon="ellipsis"
                        label={`More actions for ${job.name}`}
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={scheduleHref(job.id)}>
                          {job.canEdit ? "Edit schedule" : "View schedule"}
                        </Link>
                      </DropdownMenuItem>
                      {job.canEdit ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() => onToggleEnabled(job, !job.enabled)}
                          >
                            {job.enabled ? "Pause" : "Resume"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onDelete(job)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}
