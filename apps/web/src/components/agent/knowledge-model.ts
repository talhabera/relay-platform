import type { IconName, StatusTone } from "@/components/v2/primitives";

// Pure helpers for the Knowledge inspector tab and the Knowledge entry row (Figma 07
// `agents-customer/knowledge*`, `agents-operator/knowledge*`, `07/_local` Knowledge entry 534:74441).

export type KnowledgeKind = "customer" | "operator";

/** The fields of a `knowledge_base` row the panel reads. */
export type KnowledgeEntryData = {
  id: string;
  name: string;
  type: "file" | "website" | "api";
  status: "processing" | "ready" | "error" | null;
  fileType: string | null;
  fileSize: number | null;
  sourceUrl: string | null;
  content: string | null;
  errorMessage: string | null;
  metadata: unknown;
  updatedAt: Date;
};

/** Pasted text is stored as a `file` row with `text/plain` and no size (no schema change). */
export const TEXT_FILE_TYPE = "text/plain";

export type KnowledgeSourceKind = "file" | "website" | "text" | "api";

export function knowledgeSourceKind(entry: Pick<KnowledgeEntryData, "type" | "fileType" | "fileSize">): KnowledgeSourceKind {
  if (entry.type === "website") return "website";
  if (entry.type === "api") return "api";
  if (entry.fileType === TEXT_FILE_TYPE && !entry.fileSize) return "text";
  return "file";
}

const KIND_ICON: Record<KnowledgeSourceKind, IconName> = {
  file: "file-text",
  website: "globe",
  text: "pencil",
  api: "plug",
};

const STATUS: Record<"processing" | "ready" | "error", { tone: StatusTone; label: string }> = {
  ready: { tone: "success", label: "Ready" },
  processing: { tone: "pending", label: "Processing" },
  error: { tone: "error", label: "Error" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toUpperCase();
}

type WebsiteMeta = { wordCount?: number; pagesDone?: number; pagesTotal?: number };

function websiteMeta(metadata: unknown): WebsiteMeta {
  return metadata && typeof metadata === "object" ? (metadata as WebsiteMeta) : {};
}

export type KnowledgeEntryView = {
  kind: KnowledgeSourceKind;
  icon: IconName;
  /** Meta line left: "PDF · 412 KB", "Website · 1,240 words", "Text". */
  source: string;
  /** Meta line right: "Updated 24 Sep". */
  updated: string;
  status: { tone: StatusTone; label: string };
  /** Processing website with a known page count: "4 of 9 pages". */
  progress?: { value: number; max: number; label: string };
  /** Error line with Retry. */
  error?: string;
};

export function knowledgeEntryView(entry: KnowledgeEntryData): KnowledgeEntryView {
  const kind = knowledgeSourceKind(entry);
  const status = STATUS[entry.status ?? "processing"];
  let source: string;
  if (kind === "file") {
    const ext = fileExtension(entry.name);
    source = [ext ?? "File", entry.fileSize ? formatFileSize(entry.fileSize) : null].filter(Boolean).join(" · ");
  } else if (kind === "website") {
    const words = entry.status === "ready" ? websiteMeta(entry.metadata).wordCount : undefined;
    source = words ? `Website · ${words.toLocaleString("en-US")} words` : "Website";
  } else {
    source = kind === "text" ? "Text" : "API";
  }

  const view: KnowledgeEntryView = {
    kind,
    icon: KIND_ICON[kind],
    source,
    updated: `Updated ${entry.updatedAt.getDate()} ${MONTHS[entry.updatedAt.getMonth()]}`,
    status,
  };

  if (entry.status === "processing") {
    const { pagesDone, pagesTotal } = websiteMeta(entry.metadata);
    if (typeof pagesDone === "number" && typeof pagesTotal === "number" && pagesTotal > 0) {
      view.progress = { value: pagesDone, max: pagesTotal, label: `${pagesDone} of ${pagesTotal} pages` };
    }
  }
  if (entry.status === "error") {
    view.error = entry.errorMessage?.trim() || "Could not read this source.";
  }
  return view;
}

/** "Knowledge · 3 sources" over the entries. */
export function knowledgeGroupLabel(count: number): string {
  return `Knowledge · ${count} ${count === 1 ? "source" : "sources"}`;
}

/** Caption under the add row. */
export function knowledgeNote(kind: KnowledgeKind, agentName: string, entries: KnowledgeEntryData[]): string {
  if (kind === "operator") return `Shared by all versions of ${agentName}.`;
  const processing = entries.find((e) => e.status === "processing");
  if (processing) return `${processing.sourceUrl ? displayAddress(processing.sourceUrl) : processing.name} joins the answers when reading finishes.`;
  return "The agent answers from ready sources only.";
}

/** Empty state description. */
export function knowledgeEmptyDescription(kind: KnowledgeKind, agentName: string): string {
  return kind === "operator"
    ? `Add files, website pages or text. Every version of ${agentName} uses the same knowledge.`
    : `Add files, website pages or text. ${agentName} answers from ready sources only.`;
}

/** "https://www.acme-reinigung.de/faq/" -> "acme-reinigung.de/faq". */
export function displayAddress(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Default name for a pasted text entry: its first line, trimmed to 60 characters. */
export function textEntryName(text: string): string {
  const first = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!first) return "Text";
  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}
