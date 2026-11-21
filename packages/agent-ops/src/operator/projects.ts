import { and, eq } from "drizzle-orm";
import { db, projects } from "@relay/db";
import { z } from "zod";
import { requireCompanyMembership } from "../auth/access";

export const listProjectsSchema = z.object({
  companyId: z.string().min(1),
  includeArchived: z.boolean().optional(),
});

export const createProjectSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

export type ListProjectsInput = z.infer<typeof listProjectsSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

type ProjectRow = typeof projects.$inferSelect;

async function insertReturning(values: typeof projects.$inferInsert) {
  const [row] = await db.insert(projects).values(values).returning();
  return row as ProjectRow;
}

async function loadProjectForUser(userId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const { company } = await requireCompanyMembership(userId, project.companyId);

  if (company.id && company.id !== project.companyId) {
    throw new Error("Project not found");
  }

  return { project, company };
}

function resolveProjectArgs(
  idOrData: string | Record<string, unknown>,
  maybeData?: Record<string, unknown>,
): { projectId: string; data: Record<string, unknown> } {
  if (typeof idOrData === "string") {
    return { projectId: idOrData, data: maybeData ?? {} };
  }
  const { projectId, id, ...rest } = idOrData as {
    projectId?: string;
    id?: string;
  };
  return {
    projectId: (projectId ?? id) as string,
    data: { ...rest, ...(maybeData ?? {}) },
  };
}

export async function listProjects(
  userId: string,
  filters: Parameters<typeof listProjectsSchema.parse>[0],
) {
  const parsed = listProjectsSchema.parse(filters);
  await requireCompanyMembership(userId, parsed.companyId);

  const conditions = [eq(projects.companyId, parsed.companyId)];
  if (!parsed.includeArchived) {
    conditions.push(eq(projects.status, "active"));
  }

  const rows = await db.query.projects.findMany({
    where: and(...conditions),
  });

  const visible = (rows as ProjectRow[]).filter((row) => {
    if (parsed.includeArchived) return true;
    return row.status === undefined || row.status !== "archived";
  });

  return visible.sort((a, b) => {
    const byPosition = (a.position ?? 0) - (b.position ?? 0);
    if (byPosition !== 0) return byPosition;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });
}

export async function createProject(
  userId: string,
  data: Parameters<typeof createProjectSchema.parse>[0],
) {
  const parsed = createProjectSchema.parse(data);
  await requireCompanyMembership(userId, parsed.companyId);

  return insertReturning({
    companyId: parsed.companyId,
    name: parsed.name,
    ...(parsed.description !== undefined
      ? { description: parsed.description }
      : {}),
  });
}

export async function updateProject(
  userId: string,
  projectId: string,
  data: Parameters<typeof updateProjectSchema.parse>[0],
): Promise<ProjectRow>;
export async function updateProject(
  userId: string,
  data: { projectId: string } & Parameters<typeof updateProjectSchema.parse>[0],
): Promise<ProjectRow>;
export async function updateProject(
  userId: string,
  idOrData:
    | string
    | ({ projectId: string } & Parameters<typeof updateProjectSchema.parse>[0]),
  maybeData?: Parameters<typeof updateProjectSchema.parse>[0],
) {
  const { projectId, data } = resolveProjectArgs(
    idOrData as string | Record<string, unknown>,
    maybeData as Record<string, unknown> | undefined,
  );
  const { project } = await loadProjectForUser(userId, projectId);
  const parsed = updateProjectSchema.parse(data);
  const updatedAt = new Date();

  const setValues = {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined
      ? { description: parsed.description }
      : {}),
    ...(parsed.position !== undefined ? { position: parsed.position } : {}),
    updatedAt,
  };

  await db.update(projects).set(setValues).where(eq(projects.id, project.id));

  return { ...project, ...setValues };
}

export async function archiveProject(
  userId: string,
  projectIdOrData: string | { projectId: string } | { id: string },
) {
  const { projectId } = resolveProjectArgs(
    projectIdOrData as string | Record<string, unknown>,
  );
  const { project } = await loadProjectForUser(userId, projectId);
  const updatedAt = new Date();

  await db
    .update(projects)
    .set({ status: "archived", updatedAt })
    .where(eq(projects.id, project.id));

  return { ...project, status: "archived" as const, updatedAt };
}
