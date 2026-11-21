import { db } from "@/db";
import { chats, sessionFiles } from "@/db/schema";
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
  { params }: { params: Promise<{ chatId: string; fileId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { chatId, fileId } = await params;

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  try {
    await requireCompanyMembership(chat.companyId);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const file = await db.query.sessionFiles.findFirst({
    where: and(eq(sessionFiles.id, fileId), eq(sessionFiles.chatId, chatId)),
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
