import Link from "next/link";
import type { UIMessage } from "ai";

import { Icon, StatusChip } from "@/components/v2/primitives";
import { CronRunTranscript } from "@/components/operator/cron-run-transcript";
import type { CronRunStatus } from "@/lib/operator/cron-badge";
import { formatRunTime, lastRunResult, scheduleHref } from "@/lib/operator/cron-schedules";

type RunViewProps = {
  run: { id: string; status: CronRunStatus; fireAt: string; error: string | null };
  job: { id: string; name: string; agentName: string; timezone: string };
  messages: UIMessage[];
};

/** A Schedule run opened from Sessions: header, then the run transcript with its approvals. */
export function RunView({ run, job, messages }: RunViewProps) {
  const result = lastRunResult(run.status);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/operator?tab=sessions"
          aria-label="Back to sessions"
          className="flex items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Icon name="arrow-left" size={16} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate type-h3 text-foreground">{job.name}</h1>
          <p className="type-caption text-muted-foreground">
            Schedule run · {job.agentName} · {formatRunTime(run.fireAt, job.timezone)}
          </p>
        </div>
        {result ? <StatusChip tone={result.result}>{result.label}</StatusChip> : null}
        <Link href={scheduleHref(job.id)} className="type-caption text-primary hover:underline">
          Edit schedule
        </Link>
      </div>
      {run.error ? <p className="type-caption text-destructive">{run.error}</p> : null}
      <div className="h-[calc(100dvh-14rem)] min-h-96 overflow-hidden rounded-lg border border-border">
        <CronRunTranscript runId={run.id} messages={messages} />
      </div>
    </div>
  );
}
