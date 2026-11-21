"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  MessageSquare,
  User,
} from "lucide-react";
import { isToolUIPart, getToolName, type UIMessage } from "ai";
import { Chip } from "@/components/v2/primitives";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckpointBlock,
  hasPendingCard,
  useCheckpointCards,
} from "@/components/operator/checkpoint-block";

type CronRunTranscriptProps = {
  runId: string;
  messages: UIMessage[];
};

function getTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function formatMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      '<pre class="my-2 rounded-md bg-muted-foreground/10 p-3 overflow-x-auto"><code class="text-xs font-mono">' +
        code.trim() +
        "</code></pre>",
    );
    return `\x00CB${idx}\x00`;
  });

  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(
      '<code class="rounded bg-muted-foreground/10 px-1.5 py-0.5 text-xs font-mono">' +
        code +
        "</code>",
    );
    return `\x00IC${idx}\x00`;
  });

  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\n/g, "<br>");

  html = html.replace(/\x00IC(\d+)\x00/g, (_m, idx) => inlineCodes[+idx]);
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[+idx]);

  return html;
}

function getDownloadPath(part: UIMessage["parts"][number]): string | null {
  if (!isToolUIPart(part) || part.state !== "output-available") return null;
  const output = part.output;
  if (
    output &&
    typeof output === "object" &&
    "downloadPath" in output &&
    typeof output.downloadPath === "string"
  ) {
    return output.downloadPath;
  }
  return null;
}

function getFilename(part: UIMessage["parts"][number]): string | null {
  if (!isToolUIPart(part) || part.state !== "output-available") return null;
  const output = part.output;
  if (
    output &&
    typeof output === "object" &&
    "filename" in output &&
    typeof output.filename === "string"
  ) {
    return output.filename;
  }
  return null;
}

export function CronRunTranscript({
  runId,
  messages,
}: CronRunTranscriptProps) {
  const router = useRouter();
  const onResolved = useCallback(() => router.refresh(), [router]);
  const checkpoints = useCheckpointCards(
    { runId },
    { reloadKey: messages.length, onResolved },
  );

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">No transcript yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Run {runId.slice(0, 8)}… has no messages.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-4">
        {messages.map((message) => {
          const textContent = getTextFromParts(message.parts);
          const toolParts = message.parts.filter(isToolUIPart);

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role === "assistant" && (
                <div className="rounded-full bg-primary/10 p-1.5 h-fit">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {textContent && (
                  <div
                    className="[&_pre]:whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                      __html: formatMarkdown(textContent),
                    }}
                  />
                )}

                {toolParts.map((part, idx) => {
                  const downloadPath = getDownloadPath(part);
                  const filename = getFilename(part);
                  const pending = hasPendingCard(part);

                  return (
                    <div key={idx} className="mt-2 space-y-2">
                      <CheckpointBlock part={part} cards={checkpoints} />

                      {downloadPath && (
                        <a
                          href={downloadPath}
                          className="text-xs text-primary underline"
                          download={filename ?? undefined}
                        >
                          Download {filename ?? "Excel file"}
                        </a>
                      )}

                      {!pending && !downloadPath && isToolUIPart(part) && (
                        <Chip asStatic>
                          {getToolName(part)}
                        </Chip>
                      )}
                    </div>
                  );
                })}
              </div>
              {message.role === "user" && (
                <div className="rounded-full bg-muted p-1.5 h-fit">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
