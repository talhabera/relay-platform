import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSession, requireSession } from "@/lib/auth-server";
import { db } from "@/db";
import { readSessionFile } from "@/lib/operator/session-file-store";

const mockSession = {
  user: { id: "member-1", name: "Member", email: "member@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const mockCompany = {
  id: "company-1",
  ownerId: "owner-1",
};

const mockRun = {
  id: "run-1",
  jobId: "job-1",
  job: {
    id: "job-1",
    companyId: "company-1",
    agentId: "agent-1",
  },
};

const mockFile = {
  id: "file-1",
  chatId: null,
  cronRunId: "run-1",
  filename: 'report "../evil".xlsx',
  contentType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  byteSize: 12,
  storageKey: "session-files/cron-abc-123.xlsx",
  createdAt: new Date(),
};

function makeParams(runId: string, fileId: string) {
  return { params: Promise.resolve({ runId, fileId }) };
}

vi.mock("@/lib/operator/session-file-store", () => ({
  readSessionFile: vi.fn(),
  sanitizeDownloadFilename: vi.fn((name: string) =>
    name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\.\./g, "_").trim() ||
    "download.xlsx",
  ),
}));

describe("GET /api/operator/cron/runs/[runId]/files/[fileId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.cronRuns.findFirst).mockResolvedValue(
      mockRun as never,
    );
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.sessionFiles.findFirst).mockResolvedValue(
      mockFile as never,
    );
    vi.mocked(readSessionFile).mockResolvedValue(Buffer.from("excel-bytes"));
  });

  it("returns file bytes for a company member", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-row-1",
      companyId: "company-1",
      userId: "member-1",
    } as never);

    const res = await GET(
      new Request(
        "http://localhost:3000/api/operator/cron/runs/run-1/files/file-1",
      ),
      makeParams("run-1", "file-1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).not.toContain("..");
    expect(await res.arrayBuffer()).toEqual(
      Buffer.from("excel-bytes").buffer,
    );
    expect(readSessionFile).toHaveBeenCalledWith(
      "session-files/cron-abc-123.xlsx",
    );
  });

  it("returns 403 for a user outside the company", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    const res = await GET(
      new Request(
        "http://localhost:3000/api/operator/cron/runs/run-1/files/file-1",
      ),
      makeParams("run-1", "file-1"),
    );

    expect(res.status).toBe(403);
    expect(readSessionFile).not.toHaveBeenCalled();
  });
});
