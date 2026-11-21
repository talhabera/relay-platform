"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  setOperatorAgentUserApprove,
  setOperatorAgentUserEdit,
} from "@/app/(dashboard)/operator/actions";
import type { AccessModel, AccessRow } from "@/app/(dashboard)/agents/operator/_canvas/operator-inspector-model";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/v2/primitives";

type AccessFormProps = {
  agentId: string;
  agentName: string;
  model: AccessModel;
};

type Flag = "edit" | "approve";

/**
 * Access tab of the operator inspector (Figma 07 `agents-operator/access`, `access-member`):
 * agent users with Edit and Approve switches. The agent creator is locked on; the company owner
 * always approves; only the owner changes Approve (approve-rights spec decisions 2-5). Replaces
 * the Editors tab.
 */
export function AccessForm({ agentId, agentName, model }: AccessFormProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

  async function toggle(row: AccessRow, flag: Flag, on: boolean) {
    const key = `${row.userId}:${flag}`;
    setPending(key);
    setOverrides((prev) => ({ ...prev, [key]: on }));
    try {
      if (flag === "edit") await setOperatorAgentUserEdit(agentId, row.userId, on);
      else await setOperatorAgentUserApprove(agentId, row.userId, on);
      router.refresh();
    } catch (error) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.error(error instanceof Error ? error.message : "Could not change access");
    } finally {
      setPending(null);
    }
  }

  async function addPerson(userId: string) {
    setPending(`${userId}:add`);
    try {
      await setOperatorAgentUserEdit(agentId, userId, true);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add this person");
    } finally {
      setPending(null);
    }
  }

  const value = (row: AccessRow, flag: Flag) => overrides[`${row.userId}:${flag}`] ?? row[flag].on;

  return (
    <div data-slot="operator-access" className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="type-label text-muted-foreground">People on {agentName}</h3>
        <div className="flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex items-start gap-3 px-3 pt-2" aria-hidden>
            <span className="min-w-0 flex-1" />
            <span className="w-[52px] text-center type-label text-muted-foreground">Edit</span>
            <span className="w-16 text-center type-label text-muted-foreground">Approve</span>
          </div>
          {model.rows.map((row, index) => (
            <div
              key={row.userId}
              data-slot="agent-user-row"
              className={index === 0 ? "flex items-center gap-3 p-3" : "flex items-center gap-3 border-t border-border p-3"}
            >
              <Avatar>
                <AvatarFallback>{row.initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-body-strong text-foreground">{row.name}</span>
                <span className="truncate type-caption text-muted-foreground">{row.subtitle}</span>
              </div>
              {row.locked ? (
                <Icon name="lock" size={16} className="text-foreground" aria-label="Locked: agent creator" />
              ) : null}
              <span className="flex h-6 w-[52px] shrink-0 items-center justify-center">
                <Switch
                  aria-label={`Edit for ${row.name}`}
                  checked={value(row, "edit")}
                  disabled={row.edit.disabled || pending === `${row.userId}:edit`}
                  onCheckedChange={(on) => toggle(row, "edit", on)}
                />
              </span>
              <span className="flex h-6 w-16 shrink-0 items-center justify-center">
                <Switch
                  aria-label={`Approve for ${row.name}`}
                  checked={value(row, "approve")}
                  disabled={row.approve.disabled || pending === `${row.userId}:approve`}
                  onCheckedChange={(on) => toggle(row, "approve", on)}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="type-small text-muted-foreground">
          {model.canChangeApprove
            ? `Approve lets a person approve or reject checkpoints and retry or discard failed runs on ${agentName}. Only the company owner can turn it on or off.`
            : `Only the company owner can change Approve. Approvers approve or reject checkpoints and retry or discard failed runs on ${agentName}.`}
        </p>
        {model.canAdd ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-fit" disabled={pending?.endsWith(":add")}>
                <Icon name="plus" size={16} />
                Add person
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {model.candidates.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => addPerson(c.id)}>
                  {c.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </section>
      <section className="flex flex-col gap-2 text-muted-foreground">
        <h3 className="type-label">Everyone else</h3>
        <p className="type-small">
          Other members with Operator access can start sessions with {agentName}, answer its questions and send
          checkpoints back for changes. They see checkpoints read-only. The company owner can always approve.
        </p>
      </section>
    </div>
  );
}
