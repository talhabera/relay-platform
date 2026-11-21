import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { getSession } from "@/lib/auth-server";
import { db } from "@/db";

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

function makeFormData(overrides: Record<string, string | File> = {}) {
  const form = new FormData();
  if (!("file" in overrides)) {
    const file = new File(["test content"], "test.txt", {
      type: "text/plain",
    });
    form.set("file", file);
  }
  if (!("agentId" in overrides)) form.set("agentId", "agent-1");
  if (!("companyId" in overrides)) form.set("companyId", "company-1");

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      form.delete(key);
    } else {
      form.set(key, value);
    }
  }
  return form;
}

function makeRequest(formData: FormData) {
  return new Request("http://localhost:3000/api/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mock for insert chain
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "kb-1" }]),
      }),
    } as never);
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = makeRequest(makeFormData());
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when file is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const form = new FormData();
    form.set("agentId", "agent-1");
    form.set("companyId", "company-1");
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("File is required");
  });

  it("returns 400 when agentId or companyId is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const form = new FormData();
    form.set(
      "file",
      new File(["content"], "test.txt", { type: "text/plain" })
    );
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("agentId and companyId");
  });

  it("returns 400 for unsupported file type", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const file = new File(["data"], "test.exe", {
      type: "application/x-msdownload",
    });
    const form = makeFormData({ file });
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unsupported file type");
  });

  it("returns 400 for files exceeding size limit", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    // Create a file > 10MB
    const largeContent = new Uint8Array(11 * 1024 * 1024);
    const file = new File([largeContent], "large.txt", { type: "text/plain" });
    const form = makeFormData({ file });
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("File too large");
  });

  it("successfully uploads a text file and returns 201", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const form = makeFormData();
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.knowledgeId).toBe("kb-1");
    expect(json.fileName).toBe("test.txt");
    expect(json.fileType).toBe("txt");
    expect(json.status).toBe("ready");
  });

  it("sets status to processing for PDF files", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const file = new File(["pdf data"], "doc.pdf", { type: "application/pdf" });
    const form = makeFormData({ file });
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("processing");
    expect(json.fileType).toBe("pdf");
  });

  it("sets status to processing for DOCX files", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const file = new File(["docx data"], "doc.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const form = makeFormData({ file });
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("processing");
    expect(json.fileType).toBe("docx");
  });

  it("handles markdown files as direct text", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const file = new File(["# Heading"], "readme.md", {
      type: "text/markdown",
    });
    const form = makeFormData({ file });
    const req = makeRequest(form);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("ready");
    expect(json.fileType).toBe("md");
  });

  it("inserts into knowledge base", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const form = makeFormData();
    const req = makeRequest(form);
    await POST(req);
    expect(db.insert).toHaveBeenCalled();
  });
});
