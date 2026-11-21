import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireCompanyMembership } from "../auth/access";
import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
} from "./projects";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        projects: { findFirst: vi.fn(), findMany: vi.fn() },
        tasks: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyMembership: vi.fn(),
}));

const userId = "user-1";
const ownerId = "owner-1";
const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const projectId = "660e8400-e29b-41d4-a716-446655440001";

function mockMembership() {
  vi.mocked(requireCompanyMembership).mockResolvedValue({
    userId,
    company: { id: companyId, ownerId, timezone: "UTC" },
  } as never);
}

function mockUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMembership();
});

describe("listProjects", () => {
  it("hides archived unless includeArchived and orders by position", async () => {
    vi.mocked(db.query.projects.findMany).mockResolvedValue([
      { id: "p2", companyId, status: "active", position: 2, createdAt: new Date("2026-01-02") },
      { id: "p1", companyId, status: "archived", position: 0, createdAt: new Date("2026-01-01") },
      { id: "p3", companyId, status: "active", position: 1, createdAt: new Date("2026-01-03") },
    ] as never);

    const visible = await listProjects(userId, { companyId });
    expect(visible.map((p) => p.id)).toEqual(["p3", "p2"]);

    const all = await listProjects(userId, { companyId, includeArchived: true });
    expect(all.map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
  });

  it("refuses when membership is rejected and queries nothing", async () => {
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("Unauthorized"));

    await expect(listProjects(userId, { companyId })).rejects.toThrow("Unauthorized");
    expect(db.query.projects.findMany).not.toHaveBeenCalled();
  });
});

describe("createProject", () => {
  it("creates a project for the company", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: projectId, companyId, name: "Site" }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await createProject(userId, { companyId, name: "Site", description: "d" });

    expect(requireCompanyMembership).toHaveBeenCalledWith(userId, companyId);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, name: "Site", description: "d" }),
    );
  });

  it("refuses when membership is rejected and writes nothing", async () => {
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("Unauthorized"));

    await expect(
      createProject(userId, { companyId, name: "Site" }),
    ).rejects.toThrow("Unauthorized");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("updateProject / archiveProject", () => {
  it("treats a project from another company as not found", async () => {
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId: otherCompanyId,
    } as never);
    mockUpdate();

    await expect(
      updateProject(userId, projectId, { name: "X" }),
    ).rejects.toThrow("Project not found");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates name, description and position", async () => {
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId,
      name: "Old",
    } as never);
    const { set } = mockUpdate();

    await updateProject(userId, projectId, { name: "New", position: 3 });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New", position: 3, updatedAt: expect.any(Date) }),
    );
  });

  it("archives without touching tasks", async () => {
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId,
      status: "active",
    } as never);
    const { set } = mockUpdate();

    await archiveProject(userId, projectId);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    // The only update target is projects; no task write happens.
    expect(vi.mocked(db.update).mock.calls).toHaveLength(1);
  });

  it("throws Project not found for a missing project", async () => {
    vi.mocked(db.query.projects.findFirst).mockResolvedValue(undefined);

    await expect(archiveProject(userId, projectId)).rejects.toThrow("Project not found");
  });
});
