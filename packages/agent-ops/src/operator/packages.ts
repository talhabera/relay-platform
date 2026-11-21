import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  agents,
  agentVersions,
  cronJobs,
  db,
  getPackageDefinition,
  integrations,
  missingRequiredConnectors,
  packageInstalls,
  PACKAGE_CATALOG_VERSION,
  workflows,
  workflowStages,
  type ConnectorCatalogType,
  type PackageDefinition,
  type PackageScheduleDefinition,
  type PackageSlug,
} from "@relay/db";
import {
  computeNextFireAt,
  type CronSchedule,
  type IntervalMinutes,
} from "@relay/db/cron-schedule";
import { requireCompanyAccess } from "../auth/access";

// Package install (spec 2026-10-02-packages, decisions 4-7). Owner only.
// One transaction creates the install row, the package's agents (each with a
// live v1), its workflows and stages, and its Schedules. Install never waits
// on connectors: with a required connector missing, the Schedules are created
// paused "Waiting for connectors" and resume once the last one connects.

export class PackageInstallError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_slug" | "already_installed",
  ) {
    super(message);
    this.name = "PackageInstallError";
  }
}

type Executor = typeof db;
type Transaction = Parameters<Parameters<Executor["transaction"]>[0]>[0];

export type PackageInstallResult = {
  installId: string;
  slug: PackageSlug;
  agentIds: string[];
  workflowIds: string[];
  cronJobIds: string[];
  /** Required connectors missing at install; non-empty means Schedules are paused. */
  waitingFor: ConnectorCatalogType[];
};

function scheduleOf(
  def: PackageScheduleDefinition,
  timezone: string,
): CronSchedule {
  return def.scheduleKind === "weekly"
    ? { kind: "weekly", weekday: def.weekday, timeOfDay: def.timeOfDay, timezone }
    : { kind: "daily", timeOfDay: def.timeOfDay, timezone };
}

function scheduleOfJob(job: typeof cronJobs.$inferSelect): CronSchedule {
  const timezone = job.timezone;
  switch (job.scheduleKind) {
    case "interval":
      return {
        kind: "interval",
        intervalMinutes: (job.intervalMinutes ?? 60) as IntervalMinutes,
        timezone,
      };
    case "weekly":
      return {
        kind: "weekly",
        weekday: job.weekday ?? 1,
        timeOfDay: job.timeOfDay ?? 0,
        timezone,
      };
    default:
      return { kind: "daily", timeOfDay: job.timeOfDay ?? 0, timezone };
  }
}

/** Company-level connector types whose status is `connected`. */
export async function connectedConnectorTypes(
  companyId: string,
  executor: Executor | Transaction = db,
): Promise<string[]> {
  const rows = await executor
    .select({ type: integrations.type })
    .from(integrations)
    .where(
      and(
        eq(integrations.companyId, companyId),
        isNull(integrations.agentId),
        eq(integrations.status, "connected"),
      ),
    );
  return rows.map((r) => r.type);
}

async function insertPackageRows(
  tx: Transaction,
  input: {
    definition: PackageDefinition;
    companyId: string;
    userId: string;
    timezone: string;
    waitingFor: ConnectorCatalogType[];
    now: Date;
  },
): Promise<PackageInstallResult> {
  const { definition, companyId, userId, timezone, waitingFor, now } = input;

  const [install] = await tx
    .insert(packageInstalls)
    .values({
      companyId,
      packageSlug: definition.slug,
      installedByUserId: userId,
      catalogVersion: PACKAGE_CATALOG_VERSION,
    })
    .onConflictDoNothing()
    .returning({ id: packageInstalls.id });
  if (!install) {
    throw new PackageInstallError(
      `${definition.name} is already installed`,
      "already_installed",
    );
  }

  const agentIdByKey = new Map<string, string>();
  const versionIdByKey = new Map<string, string>();
  for (const def of definition.agents) {
    const [agent] = await tx
      .insert(agents)
      .values({
        name: def.name,
        description: def.description,
        companyId,
        kind: "operator",
        packageSlug: definition.slug,
        model: def.model,
        createdByUserId: userId,
      })
      .returning({ id: agents.id });
    const [version] = await tx
      .insert(agentVersions)
      .values({
        agentId: agent.id,
        name: "v1",
        instructions: def.instructions,
        toolToggles: def.toolToggles,
        status: "live" as const,
        model: def.model,
        createdByUserId: userId,
      })
      .returning({ id: agentVersions.id });
    agentIdByKey.set(def.key, agent.id);
    versionIdByKey.set(def.key, version.id);
  }

  const workflowIds: string[] = [];
  for (const def of definition.workflows) {
    const [workflow] = await tx
      .insert(workflows)
      .values({
        companyId,
        packageSlug: definition.slug,
        name: def.name,
        flow: def.flow,
        position: def.position,
        weeklyTarget: def.weeklyTarget,
        targetMetricKey: def.targetMetricKey,
        intake: [...def.intake],
      })
      .returning({ id: workflows.id });
    const stages = await tx
      .insert(workflowStages)
      .values(
        def.stages.map((s) => ({
          workflowId: workflow.id,
          order: s.order,
          name: s.name,
          agentId: s.agentKey === null ? null : agentIdByKey.get(s.agentKey)!,
          metricKey: s.metricKey,
        })),
      )
      .returning({ id: workflowStages.id, order: workflowStages.order });
    if (def.inboundStageOrder !== null) {
      const inbound = stages.find((s) => s.order === def.inboundStageOrder);
      await tx
        .update(workflows)
        .set({ inboundStageId: inbound?.id ?? null })
        .where(eq(workflows.id, workflow.id));
    }
    workflowIds.push(workflow.id);
  }

  const paused = waitingFor.length > 0;
  const jobs =
    definition.schedules.length === 0
      ? []
      : await tx
          .insert(cronJobs)
          .values(
            definition.schedules.map((s) => ({
              companyId,
              agentId: agentIdByKey.get(s.agentKey)!,
              versionId: versionIdByKey.get(s.agentKey)!,
              name: s.name,
              prompt: s.prompt,
              scheduleKind: s.scheduleKind,
              intervalMinutes: null,
              weekday: s.scheduleKind === "weekly" ? s.weekday : null,
              timeOfDay: s.timeOfDay,
              timezone,
              enabled: !paused,
              pausedReason: paused ? ("waiting_for_connectors" as const) : null,
              packageSlug: definition.slug,
              nextFireAt: computeNextFireAt(scheduleOf(s, timezone), now),
              createdByUserId: userId,
            })),
          )
          .returning({ id: cronJobs.id });

  return {
    installId: install.id,
    slug: definition.slug,
    agentIds: Array.from(agentIdByKey.values()),
    workflowIds,
    cronJobIds: jobs.map((j) => j.id),
    waitingFor,
  };
}

/**
 * Installs a catalog package for a company. Owner only (decision 5).
 * Throws `PackageInstallError` for an unknown slug or a second install.
 */
export async function installPackage(
  userId: string,
  companyId: string,
  slug: string,
  now: Date = new Date(),
): Promise<PackageInstallResult> {
  const { company } = await requireCompanyAccess(userId, companyId);
  const definition = getPackageDefinition(slug);
  if (!definition) {
    throw new PackageInstallError("Unknown package", "unknown_slug");
  }

  const connected = await connectedConnectorTypes(companyId);
  const waitingFor = missingRequiredConnectors(definition, connected);

  return db.transaction((tx) =>
    insertPackageRows(tx, {
      definition,
      companyId,
      userId,
      timezone: company.timezone || "UTC",
      waitingFor,
      now,
    }),
  );
}

/**
 * Connector-connected hook (decision 6): resumes every package Schedule
 * paused "Waiting for connectors" whose package now has all its required
 * connectors. Call after a company-level connector turns `connected`; the
 * caller has already checked access. Returns the resumed job ids.
 */
export async function resumeWaitingPackageSchedules(
  companyId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const waiting = await db
    .select()
    .from(cronJobs)
    .where(
      and(
        eq(cronJobs.companyId, companyId),
        eq(cronJobs.pausedReason, "waiting_for_connectors"),
      ),
    );
  if (waiting.length === 0) return [];

  const connected = await connectedConnectorTypes(companyId);
  const ready = new Set<string>();
  for (const job of waiting) {
    const definition = job.packageSlug
      ? getPackageDefinition(job.packageSlug)
      : null;
    // A slug that left the catalog has nothing left to wait for.
    if (!definition || missingRequiredConnectors(definition, connected).length === 0) {
      ready.add(job.id);
    }
  }
  if (ready.size === 0) return [];

  const resumed: string[] = [];
  await db.transaction(async (tx) => {
    for (const job of waiting) {
      if (!ready.has(job.id)) continue;
      const schedule = scheduleOfJob(job);
      const rows = await tx
        .update(cronJobs)
        .set({
          enabled: true,
          pausedReason: null,
          nextFireAt: computeNextFireAt(schedule, now),
          updatedAt: now,
        })
        .where(
          and(
            eq(cronJobs.id, job.id),
            eq(cronJobs.pausedReason, "waiting_for_connectors"),
          ),
        )
        .returning({ id: cronJobs.id });
      resumed.push(...rows.map((r) => r.id));
    }
  });
  return resumed;
}

/** Install rows for a company, keyed by slug. Callers check access. */
export async function listPackageInstalls(
  companyId: string,
  slugs?: readonly string[],
) {
  return db
    .select()
    .from(packageInstalls)
    .where(
      slugs && slugs.length > 0
        ? and(
            eq(packageInstalls.companyId, companyId),
            inArray(packageInstalls.packageSlug, [...slugs]),
          )
        : eq(packageInstalls.companyId, companyId),
    );
}
