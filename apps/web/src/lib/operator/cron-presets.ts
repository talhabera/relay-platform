import type { CreateCronJobInput } from "@/lib/validators/cron";

export type CronPresetValue =
  | `interval:${number}`
  | "daily"
  | "weekly";

export type CronPreset = {
  label: string;
  value: CronPresetValue;
};

export const CRON_PRESETS: CronPreset[] = [
  { label: "Every 5 minutes", value: "interval:5" },
  { label: "Every 10 minutes", value: "interval:10" },
  { label: "Every 15 minutes", value: "interval:15" },
  { label: "Every 30 minutes", value: "interval:30" },
  { label: "Every 1 hour", value: "interval:60" },
  { label: "Every 2 hours", value: "interval:120" },
  { label: "Every 3 hours", value: "interval:180" },
  { label: "Every 6 hours", value: "interval:360" },
  { label: "Every 12 hours", value: "interval:720" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatTimeOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseTimeOfDay(value: string): number {
  const [hourPart, minutePart] = value.split(":");
  const hour = Number(hourPart ?? 0);
  const minute = Number(minutePart ?? 0);
  return hour * 60 + minute;
}

export function formatCronSchedule(job: {
  scheduleKind: "interval" | "daily" | "weekly";
  intervalMinutes: number | null;
  weekday: number | null;
  timeOfDay: number | null;
  timezone: string;
}): string {
  switch (job.scheduleKind) {
    case "interval": {
      const minutes = job.intervalMinutes ?? 0;
      if (minutes < 60) return `Every ${minutes} min (${job.timezone})`;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `Every ${hours}h (${job.timezone})`;
      }
      return `Every ${minutes} min (${job.timezone})`;
    }
    case "daily":
      return `Daily at ${formatTimeOfDay(job.timeOfDay ?? 0)} (${job.timezone})`;
    case "weekly":
      return `Weekly ${WEEKDAY_LABELS[job.weekday ?? 0]} ${formatTimeOfDay(job.timeOfDay ?? 0)} (${job.timezone})`;
  }
}

export function jobToPresetValue(job: {
  scheduleKind: "interval" | "daily" | "weekly";
  intervalMinutes: number | null;
}): CronPresetValue {
  if (job.scheduleKind === "interval") {
    return `interval:${job.intervalMinutes ?? 30}`;
  }
  return job.scheduleKind;
}

export function presetToScheduleFields(
  preset: CronPresetValue,
  options: { timeOfDay: number; weekday: number; timezone: string },
): Pick<
  CreateCronJobInput,
  "scheduleKind" | "intervalMinutes" | "weekday" | "timeOfDay" | "timezone"
> {
  if (preset === "daily") {
    return {
      scheduleKind: "daily",
      timeOfDay: options.timeOfDay,
      timezone: options.timezone,
    };
  }

  if (preset === "weekly") {
    return {
      scheduleKind: "weekly",
      weekday: options.weekday,
      timeOfDay: options.timeOfDay,
      timezone: options.timezone,
    };
  }

  const minutes = Number(preset.replace("interval:", ""));
  return {
    scheduleKind: "interval",
    intervalMinutes: minutes,
    timezone: options.timezone,
  };
}
