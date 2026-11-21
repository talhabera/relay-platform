import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export function sessionStorageRoot(
  rootDir = path.join(process.cwd(), "storage"),
) {
  return rootDir;
}

export async function saveSessionFile(
  bytes: Buffer,
  _filename: string,
  rootDir = sessionStorageRoot(),
): Promise<{ storageKey: string; byteSize: number }> {
  const storageKey = `session-files/${randomUUID()}.xlsx`;
  const filePath = path.join(rootDir, storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  return { storageKey, byteSize: bytes.byteLength };
}

export async function readSessionFile(
  storageKey: string,
  rootDir = sessionStorageRoot(),
): Promise<Buffer> {
  if (storageKey.includes("..") || !storageKey.startsWith("session-files/")) {
    throw new Error("Invalid storage key");
  }

  return readFile(path.join(rootDir, storageKey));
}

export function sanitizeDownloadFilename(filename: string): string {
  const sanitized = filename
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\.\./g, "_")
    .trim();

  return sanitized || "download.xlsx";
}
