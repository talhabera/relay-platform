"use client";

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PIPELINE_EMPTY } from "@/components/operator/revenue-copy";
import { filterPipelineRecords } from "@/lib/operator/pipeline";

export type PipelineRow = {
  id: string;
  name: string;
  domain: string | null;
  score: number | null;
  status: string;
  nextFollowUpAt: string | null;
  pendingCount: number;
  payload: Record<string, unknown>;
  latestAction: {
    status: string;
    body: string;
  } | null;
};

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "researched", label: "Researched" },
  { value: "outreach_pending", label: "Outreach pending" },
  { value: "outreach_approved", label: "Outreach approved" },
] as const;

export function OperatorPipelineTab({ rows }: { rows: PipelineRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filterPipelineRecords(rows, {
        q,
        status: status === "all" ? undefined : status,
      }),
    [rows, q, status],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {PIPELINE_EMPTY}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name or domain"
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Next follow-up</TableHead>
            <TableHead>Pending</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => setSelectedId(row.id)}
            >
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{row.domain ?? "—"}</TableCell>
              <TableCell>{row.score ?? "—"}</TableCell>
              <TableCell>{formatStatus(row.status)}</TableCell>
              <TableCell>
                {row.nextFollowUpAt
                  ? new Date(row.nextFollowUpAt).toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell>{row.pendingCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  {selected.domain ?? "No domain"} · {formatStatus(selected.status)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4 text-sm">
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
                {selected.latestAction ? (
                  <div className="space-y-1">
                    <p className="font-medium">
                      Latest action · {formatStatus(selected.latestAction.status)}
                    </p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {selected.latestAction.body}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No outreach yet.</p>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
