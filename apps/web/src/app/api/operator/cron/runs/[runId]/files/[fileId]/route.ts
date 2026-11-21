import { db } from "@/db";
import { cronRuns, sessionFiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";
import {
  readSessionFile,
  sanitizeDownloadFilename,
} from "@/lib/operator/session-file-store";

const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; fileId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runId, fileId } = await params;

  const run = await db.query.cronRuns.findFirst({
    where: eq(cronRuns.id, runId),
    with: { job: true },
  });

  if (!run?.job) {
    return new Response("Run not found", { status: 404 });
  }

  try {
    await requireCompanyMembership(run.job.companyId);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const file = await db.query.sessionFiles.findFirst({
    where: and(eq(sessionFiles.id, fileId), eq(sessionFiles.cronRunId, runId)),
  });

  if (!file) {
    return new Response("File not found", { status: 404 });
  }

  const bytes = await readSessionFile(file.storageKey);
  const filename = sanitizeDownloadFilename(file.filename);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": EXCEL_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
