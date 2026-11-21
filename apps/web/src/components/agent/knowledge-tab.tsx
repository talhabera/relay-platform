"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";

import {
  createKnowledgeEntry,
  createKnowledgeFromWebsite,
  deleteKnowledgeEntry,
  updateKnowledgeEntry,
} from "@/app/(dashboard)/agents/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { Icon, IconButton } from "@/components/v2/primitives";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from "@/constants";
import type {
  CreateKnowledgeEntryInput,
  CreateKnowledgeFromWebsiteInput,
  UpdateKnowledgeEntryInput,
} from "@/lib/validators/knowledge";
import { cn } from "@/lib/utils";

import { KnowledgeEntry } from "./knowledge-entry";
import {
  TEXT_FILE_TYPE,
  displayAddress,
  knowledgeEmptyDescription,
  knowledgeEntryView,
  knowledgeGroupLabel,
  knowledgeNote,
  textEntryName,
  type KnowledgeEntryData,
  type KnowledgeKind,
} from "./knowledge-model";

type WebsiteResult = { id: string; status: "ready" } | { id: string; status: "error"; error: string };

export type KnowledgeActions = {
  createEntry?: (data: CreateKnowledgeEntryInput) => Promise<{ id: string }>;
  createFromWebsite?: (data: CreateKnowledgeFromWebsiteInput) => Promise<WebsiteResult>;
  updateEntry?: (id: string, data: UpdateKnowledgeEntryInput) => Promise<void>;
  deleteEntry?: (id: string) => Promise<void>;
};

type KnowledgeTabProps = KnowledgeActions & {
  agentId: string;
  companyId: string;
  /** Used in the empty state and note copy. */
  agentName?: string;
  /** customer: "answers from ready sources"; operator: "shared by all versions". */
  kind?: KnowledgeKind;
  entries: KnowledgeEntryData[];
  /** Add, edit, retry and delete. Read-only viewers see the list only. */
  canManage?: boolean;
  className?: string;
};

type AddMode = "file" | "website" | "text";
type DialogState = { mode: AddMode; replace?: KnowledgeEntryData; key: number } | null;

/**
 * Knowledge inspector tab (Figma 07 `agents-customer/knowledge` 535:74704, `knowledge-processing`
 * 411:37108, `knowledge-empty` 535:76294, `knowledge-error` 535:76655; `agents-operator/knowledge`
 * 541:13655, `knowledge-empty` 542:13999): "Knowledge · N sources" over Knowledge entry rows,
 * or the Empty state; then Upload file / Add website / Add text and a caption.
 */
export function KnowledgeTab({
  agentId,
  companyId,
  agentName = "This agent",
  kind = "customer",
  entries,
  canManage = true,
  className,
  createEntry = createKnowledgeEntry,
  createFromWebsite = createKnowledgeFromWebsite,
  updateEntry = updateKnowledgeEntry,
  deleteEntry = deleteKnowledgeEntry,
}: KnowledgeTabProps) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<KnowledgeEntryData | null>(null);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const open = (mode: AddMode, replace?: KnowledgeEntryData) =>
    setDialog((d) => ({ mode, replace, key: (d?.key ?? 0) + 1 }));

  async function retry(entry: KnowledgeEntryData) {
    if (!entry.sourceUrl) return;
    setRetrying(entry.id);
    try {
      const result = await createFromWebsite({ url: entry.sourceUrl, name: entry.name, agentId, companyId });
      await deleteEntry(entry.id);
      if (result.status === "error") toast.error(`Could not read ${displayAddress(entry.sourceUrl)}: ${result.error}`);
      else toast.success(`${displayAddress(entry.sourceUrl)} is ready`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry this source");
    } finally {
      setRetrying(null);
    }
  }

  async function remove(entry: KnowledgeEntryData) {
    try {
      await deleteEntry(entry.id);
      toast.success(`${entry.name} removed`);
      router.refresh();
    } catch {
      toast.error(`Could not remove ${entry.name}`);
    }
  }

  return (
    <div data-slot="knowledge-tab" data-kind={kind} className={cn("flex w-full flex-col gap-3 pt-2", className)}>
      {entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No knowledge yet" description={knowledgeEmptyDescription(kind, agentName)} />
      ) : (
        <div data-slot="knowledge-group" className="flex w-full flex-col gap-2">
          <span className="type-label text-muted-foreground">{knowledgeGroupLabel(entries.length)}</span>
          {entries.map((entry) => {
            const view = knowledgeEntryView(entry);
            return (
              <KnowledgeEntry
                key={entry.id}
                name={entry.name}
                view={view}
                retrying={retrying === entry.id}
                onRetry={canManage && view.kind === "website" && entry.sourceUrl ? () => retry(entry) : undefined}
                menu={
                  canManage ? (
                    <EntryMenu
                      entry={entry}
                      onEditAddress={() => open("website", entry)}
                      onEditText={() => open("text", entry)}
                      onDelete={() => setConfirmDelete(entry)}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

      {canManage ? (
        <div data-slot="knowledge-add" className="flex w-full gap-2">
          <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => open("file")}>
            <Icon name="upload" size={16} />
            Upload file
          </Button>
          <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => open("website")}>
            <Icon name="globe" size={16} />
            Add website
          </Button>
          <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => open("text")}>
            <Icon name="pencil" size={16} />
            Add text
          </Button>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <p className="type-caption text-muted-foreground">{knowledgeNote(kind, agentName, entries)}</p>
      ) : null}

      {dialog ? (
        <AddKnowledgeDialog
          key={dialog.key}
          mode={dialog.mode}
          replace={dialog.replace}
          agentId={agentId}
          companyId={companyId}
          agentName={agentName}
          createEntry={createEntry}
          createFromWebsite={createFromWebsite}
          updateEntry={updateEntry}
          deleteEntry={deleteEntry}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => (o ? null : setConfirmDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {agentName} stops answering from this source. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (confirmDelete) void remove(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EntryMenu({
  entry,
  onEditAddress,
  onEditText,
  onDelete,
}: {
  entry: KnowledgeEntryData;
  onEditAddress: () => void;
  onEditText: () => void;
  onDelete: () => void;
}) {
  const kind = knowledgeEntryView(entry).kind;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon="ellipsis" label={`${entry.name} actions`} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {kind === "website" ? (
          <>
            <DropdownMenuItem onSelect={onEditAddress}>Edit address</DropdownMenuItem>
            {entry.sourceUrl ? (
              <DropdownMenuItem asChild>
                <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open page
                </a>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {kind === "text" ? <DropdownMenuItem onSelect={onEditText}>Edit text</DropdownMenuItem> : null}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DIALOG_COPY: Record<AddMode, { title: string; description: string; submit: string }> = {
  file: {
    title: "Upload file",
    description: "PDF, TXT, MD or DOCX up to 10 MB.",
    submit: "Upload",
  },
  website: {
    title: "Add website",
    description: "The page is read once and its main content joins the agent's knowledge.",
    submit: "Add website",
  },
  text: {
    title: "Add text",
    description: "Paste prices, opening hours, service areas or anything the agent should know.",
    submit: "Add text",
  },
};

function AddKnowledgeDialog({
  mode,
  replace,
  agentId,
  companyId,
  agentName,
  createEntry,
  createFromWebsite,
  updateEntry,
  deleteEntry,
  onClose,
}: Required<KnowledgeActions> & {
  mode: AddMode;
  replace?: KnowledgeEntryData;
  agentId: string;
  companyId: string;
  agentName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = React.useId();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [url, setUrl] = React.useState(replace?.sourceUrl ?? "");
  const [name, setName] = React.useState(replace?.name ?? "");
  const [text, setText] = React.useState(replace?.content ?? "");
  const copy = replace
    ? { ...DIALOG_COPY[mode], title: mode === "website" ? "Edit address" : "Edit text", submit: "Save" }
    : DIALOG_COPY[mode];

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (next.size > MAX_FILE_SIZE) {
      toast.error("File is too large. The limit is 10 MB.");
      return;
    }
    if (!ALLOWED_FILE_TYPES.includes(next.type)) {
      toast.error("Unsupported file type. Use PDF, TXT, MD or DOCX.");
      return;
    }
    setFile(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "file") {
        if (!file) {
          toast.error("Choose a file first.");
          return;
        }
        await createEntry({
          name: file.name,
          agentId,
          companyId,
          type: "file",
          content: await file.text(),
          fileType: file.type,
          fileSize: file.size,
        });
        toast.success(`${file.name} added`);
      } else if (mode === "website") {
        if (!url.trim()) {
          toast.error("Enter the page address.");
          return;
        }
        const result = await createFromWebsite({ url: url.trim(), name: name.trim() || undefined, agentId, companyId });
        if (replace) await deleteEntry(replace.id);
        if (result.status === "error") toast.error(`Could not read the page: ${result.error}`);
        else toast.success(`${displayAddress(url.trim())} is ready`);
      } else {
        if (!text.trim()) {
          toast.error("Enter some text.");
          return;
        }
        const entryName = name.trim() || textEntryName(text);
        if (replace) {
          await updateEntry(replace.id, { name: entryName, content: text });
          toast.success("Text saved");
        } else {
          await createEntry({ name: entryName, agentId, companyId, type: "file", content: text, fileType: TEXT_FILE_TYPE });
          toast.success(`${entryName} added`);
        }
      }
      router.refresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add this source");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description} {agentName} answers from ready sources only.
            </DialogDescription>
          </DialogHeader>

          {mode === "file" ? (
            <div
              data-slot="knowledge-dropzone"
              data-dragging={dragging || undefined}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-6 text-center",
                dragging && "border-primary bg-primary-soft",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,.md,.docx"
                className="sr-only"
                aria-label="File"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <Icon name={file ? "file-text" : "upload"} size={24} className="text-muted-foreground" />
              <p className="type-body-strong text-foreground">{file ? file.name : "Drop a file here"}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                {file ? "Choose another file" : "Browse"}
              </Button>
            </div>
          ) : null}

          {mode === "website" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-url`}>Page address</Label>
                <Input
                  id={`${id}-url`}
                  type="url"
                  required
                  placeholder="https://acme-reinigung.de/faq"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-name`}>Name (optional)</Label>
                <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </>
          ) : null}

          {mode === "text" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-title`}>Name (optional)</Label>
                <Input
                  id={`${id}-title`}
                  placeholder="Service areas Munich and Augsburg"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-text`}>Text</Label>
                <Textarea id={`${id}-text`} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
