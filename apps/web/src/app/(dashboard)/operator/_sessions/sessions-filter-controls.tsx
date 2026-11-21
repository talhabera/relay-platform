"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/v2/primitives";

import { sessionsHref, type SessionRange, type SessionsFilters } from "./sessions-list";

type Option = { id: string; name: string };

type SessionsFilterControlsProps = {
  filters: SessionsFilters;
  workflows: Option[];
  agents: Option[];
  /** Preformatted label per range, e.g. { "30d": "26 Aug – 25 Sep" }. */
  rangeLabels: Record<SessionRange, string>;
};

const ALL = "__all";

const RANGE_OPTIONS: { value: SessionRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

/** Figma 05 sessions `filters/controls`: workflow, agent, date range, search. State lives in the URL. */
export function SessionsFilterControls({ filters, workflows, agents, rangeLabels }: SessionsFilterControlsProps) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);

  const go = (patch: Partial<SessionsFilters>) => router.push(sessionsHref(filters, patch));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.workflowId ?? ALL}
        onValueChange={(v) => go({ workflowId: v === ALL ? null : v })}
      >
        <SelectTrigger aria-label="Workflow" className="w-[176px] bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All workflows</SelectItem>
          {workflows.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.agentId ?? ALL} onValueChange={(v) => go({ agentId: v === ALL ? null : v })}>
        <SelectTrigger aria-label="Agent" className="w-[176px] bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All agents</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.range} onValueChange={(v) => go({ range: v as SessionRange })}>
        <SelectTrigger aria-label="Date range" className="bg-background font-medium [&>svg:last-child]:hidden">
          <Icon name="calendar" size={16} />
          <span>{rangeLabels[filters.range]}</span>
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() });
        }}
      >
        <Input
          type="search"
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => {
            if (q.trim() !== filters.q) go({ q: q.trim() });
          }}
          className="h-10 w-[220px]"
        />
      </form>
    </div>
  );
}
