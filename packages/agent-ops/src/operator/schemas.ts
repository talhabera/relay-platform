import {
  INTERVAL_MINUTES,
  isValidTimeZone,
  type IntervalMinutes,
} from "@relay/db/cron-schedule";
import { z } from "zod";

export { INTERVAL_MINUTES };

const cronScheduleFieldsSchema = z.object({
  scheduleKind: z.enum(["interval", "daily", "weekly"]),
  intervalMinutes: z.number().int().optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  timeOfDay: z.number().int().min(0).max(1439).optional(),
  timezone: z.string().min(1).default("UTC"),
});

type CronScheduleFields = z.infer<typeof cronScheduleFieldsSchema>;

function refineCronSchedule(
  data: CronScheduleFields,
  ctx: z.RefinementCtx,
): void {
  if (!isValidTimeZone(data.timezone)) {
    ctx.addIssue({
      code: "custom",
      path: ["timezone"],
      message: "Invalid timezone",
    });
  }

  if (data.scheduleKind === "interval") {
    if (
      data.intervalMinutes === undefined ||
      !(INTERVAL_MINUTES as readonly number[]).includes(data.intervalMinutes)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["intervalMinutes"],
        message: "intervalMinutes must be one of the allowed interval values",
      });
    }
    return;
  }

  if (data.scheduleKind === "daily") {
    if (data.timeOfDay === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["timeOfDay"],
        message: "timeOfDay is required for daily schedules",
      });
    }
    return;
  }

  if (data.weekday === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["weekday"],
      message: "weekday is required for weekly schedules",
    });
  }
  if (data.timeOfDay === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["timeOfDay"],
      message: "timeOfDay is required for weekly schedules",
    });
  }
}

export function validateCronScheduleFields(data: CronScheduleFields): void {
  const result = cronScheduleFieldsSchema
    .superRefine(refineCronSchedule)
    .safeParse(data);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid schedule");
  }
}

export const createCronJobSchema = z
  .object({
    agentId: z.string().uuid(),
    versionId: z.string().uuid(),
    name: z.string().min(1).max(100),
    prompt: z.string().min(1).max(50000),
    enabled: z.boolean().default(true),
  })
  .extend(cronScheduleFieldsSchema.shape)
  .superRefine(refineCronSchedule);

export const updateCronJobSchema = z
  .object({
    jobId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    name: z.string().min(1).max(100).optional(),
    prompt: z.string().min(1).max(50000).optional(),
    enabled: z.boolean().optional(),
  })
  .extend(cronScheduleFieldsSchema.partial().shape)
  // Zod v4 still applies the inner `.default("UTC")` under `.partial()`, so an
  // update that omits the zone (a pause toggle, a rename) would move the job
  // to UTC. An update keeps the stored zone unless it names one.
  .extend({ timezone: z.string().min(1).optional() })
  .superRefine((data, ctx) => {
    if (data.scheduleKind === undefined) {
      return;
    }
    refineCronSchedule(
      {
        scheduleKind: data.scheduleKind,
        intervalMinutes: data.intervalMinutes,
        weekday: data.weekday,
        timeOfDay: data.timeOfDay,
        timezone: data.timezone ?? "UTC",
      },
      ctx,
    );
  });

export type CreateCronJobInput = z.infer<typeof createCronJobSchema>;
export type UpdateCronJobInput = z.infer<typeof updateCronJobSchema>;

export function buildCronSchedule(
  input: Pick<
    CreateCronJobInput,
    | "scheduleKind"
    | "intervalMinutes"
    | "weekday"
    | "timeOfDay"
    | "timezone"
  >,
) {
  switch (input.scheduleKind) {
    case "interval":
      return {
        kind: "interval" as const,
        intervalMinutes: input.intervalMinutes as IntervalMinutes,
        timezone: input.timezone,
      };
    case "daily":
      return {
        kind: "daily" as const,
        timeOfDay: input.timeOfDay!,
        timezone: input.timezone,
      };
    case "weekly":
      return {
        kind: "weekly" as const,
        weekday: input.weekday!,
        timeOfDay: input.timeOfDay!,
        timezone: input.timezone,
      };
  }
}

export const createOperatorAgentSchema = z.object({
  companyId: z.string().uuid("Invalid company ID"),
  name: z.string().min(1, "Agent name is required").max(100),
  description: z.string().max(500).optional(),
});

export const forkVersionSchema = z.object({
  name: z.string().min(1, "Version name is required").max(64),
  changeNote: z.string().trim().max(500).optional(),
});

export const toolTogglesSchema = z
  .object({
    webSearch: z.boolean(),
    excel: z.boolean(),
    companyMemory: z.boolean(),
    proposeAction: z.boolean(),
  })
  .strict();

export const updateOperatorVersionSchema = z.object({
  instructions: z.string().max(50000).optional().nullable(),
  toolToggles: toolTogglesSchema.optional(),
  model: z.enum(["haiku", "sonnet", "opus"]).optional(),
});

export type CreateOperatorAgentInput = z.infer<typeof createOperatorAgentSchema>;
export type ForkVersionInput = z.infer<typeof forkVersionSchema>;
export type UpdateOperatorVersionInput = z.infer<
  typeof updateOperatorVersionSchema
>;
