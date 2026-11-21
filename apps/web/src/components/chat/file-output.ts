import { isToolUIPart, type UIMessage } from "ai";

export type FileOutput = {
  downloadPath: string;
  filename: string;
  kind: "xlsx" | "file";
};

export function fileOutputFromPart(
  part: UIMessage["parts"][number],
): FileOutput | null {
  if (!isToolUIPart(part) || part.state !== "output-available") return null;
  const output = part.output;
  if (!output || typeof output !== "object") return null;
  if (
    !("downloadPath" in output) ||
    typeof output.downloadPath !== "string"
  ) {
    return null;
  }
  const filename =
    "filename" in output && typeof output.filename === "string"
      ? output.filename
      : "Excel file";
  const kind = filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "file";
  return { downloadPath: output.downloadPath, filename, kind };
}

export function fileCardFromRow(row: {
  downloadPath: string | null;
  filename: string | null;
}): FileOutput | null {
  if (!row.downloadPath) return null;
  const filename = row.filename ?? "Excel file";
  const kind = filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "file";
  return { downloadPath: row.downloadPath, filename, kind };
}

export function fileAvailabilityFromHttpStatus(
  status: number,
): "available" | "unavailable" {
  if (status === 404 || status === 403) return "unavailable";
  return "available";
}
