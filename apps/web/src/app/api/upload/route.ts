import { getSession } from "@/lib/auth-server";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { db } from "@/db";
import { knowledgeBase } from "@/db/schema";
import { MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from "@/constants";

export const maxDuration = 60;

/** Map MIME types to human-readable file type labels */
const FILE_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

export async function POST(req: Request) {
  // 1. Validate auth
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.upload({ userId: session.user.id }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial);
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const agentId = formData.get("agentId") as string | null;
  const companyId = formData.get("companyId") as string | null;

  // 3. Validate required fields
  if (!file) {
    return Response.json({ error: "File is required" }, { status: 400 });
  }

  if (!agentId || !companyId) {
    return Response.json(
      { error: "agentId and companyId are required" },
      { status: 400 }
    );
  }

  // 4. Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return Response.json(
      {
        error: `Unsupported file type: ${file.type}. Allowed: PDF, TXT, MD, DOCX`,
      },
      { status: 400 }
    );
  }

  // 5. Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      {
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      },
      { status: 400 }
    );
  }

  // 6. Read file content
  let textContent: string;

  try {
    if (file.type === "application/pdf") {
      // For PDF files, we store the raw text extraction
      // TODO: Use a proper PDF parser (pdf-parse, pdfjs-dist) in production
      // For now, store a placeholder indicating PDF processing is needed
      const buffer = await file.arrayBuffer();
      textContent = `[PDF file: ${file.name}, ${buffer.byteLength} bytes — text extraction pending]`;
    } else if (
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      // TODO: Use a DOCX parser (mammoth, docx) in production
      const buffer = await file.arrayBuffer();
      textContent = `[DOCX file: ${file.name}, ${buffer.byteLength} bytes — text extraction pending]`;
    } else {
      // TXT and MD files can be read directly as text
      textContent = await file.text();
    }
  } catch {
    return Response.json(
      { error: "Failed to read file content" },
      { status: 500 }
    );
  }

  // 7. Insert into knowledge base with 'processing' status, then update to 'ready'
  const fileType = FILE_TYPE_LABELS[file.type] ?? file.type;

  const [entry] = await db
    .insert(knowledgeBase)
    .values({
      name: file.name,
      description: `Uploaded file: ${file.name}`,
      agentId,
      companyId,
      type: "file",
      content: textContent,
      fileType,
      fileSize: file.size,
      status: "processing",
    })
    .returning({ id: knowledgeBase.id });

  // For text files that don't need processing, mark as ready immediately
  const isDirectText =
    file.type === "text/plain" || file.type === "text/markdown";

  if (isDirectText) {
    const { eq } = await import("drizzle-orm");
    await db
      .update(knowledgeBase)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(knowledgeBase.id, entry.id));
  }

  // TODO: For PDF/DOCX, trigger an async background job to extract text
  // and update status to 'ready' once complete.

  return Response.json(
    {
      success: true,
      knowledgeId: entry.id,
      fileName: file.name,
      fileType,
      fileSize: file.size,
      status: isDirectText ? "ready" : "processing",
    },
    { status: 201 }
  );
}
