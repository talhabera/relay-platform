"use client";

import { Check, Loader2, X } from "lucide-react";
import { StatusChip } from "@/components/v2/primitives";
import { FileOutputCard } from "@/components/chat/file-output-card";
import { fileCardFromRow } from "@/components/chat/file-output";
import type { ToolTreeRow } from "@/components/chat/tool-tree";

export type ToolCallTreeProps = {
  rows: ToolTreeRow[];
};

function stateLabel(state: ToolTreeRow["state"]): string {
  switch (state) {
    case "in-progress":
      return "in-progress";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function ToolCallTree({ rows }: ToolCallTreeProps) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row) => {
        const file = fileCardFromRow(row);
        return (
          <div key={row.toolCallId} className="space-y-2">
            <div className="flex items-start gap-2">
              {row.state === "in-progress" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-primary" />
              ) : row.state === "done" ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={
                      row.state === "done"
                        ? "text-sm text-muted-foreground line-through"
                        : "text-sm"
                    }
                  >
                    {row.name}
                  </span>
                  <StatusChip
                    tone={
                      row.state === "failed"
                        ? "error"
                        : row.state === "done"
                          ? "success"
                          : "pending"
                    }
                    className="capitalize"
                  >
                    {stateLabel(row.state)}
                  </StatusChip>
                </div>
                {row.summary ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.summary}
                  </p>
                ) : null}
              </div>
            </div>
            {file ? (
              <FileOutputCard
                downloadPath={file.downloadPath}
                filename={file.filename}
                kind={file.kind}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
