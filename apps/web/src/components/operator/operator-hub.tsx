"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  MessageSquare,
  Plus,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CreateOperatorAgentDialog } from "@/components/operator/create-operator-agent-dialog";
import { ForkVersionDialog } from "@/components/operator/fork-version-dialog";
import { InstallPackageDialog } from "@/components/operator/install-package-dialog";
import { createOperatorSession } from "@/app/(dashboard)/operator/actions";
import { Chip } from "@/components/v2/primitives";
import { REVENUE_EMPTY_BODY } from "@/components/operator/revenue-copy";

export type OperatorHubAgent = {
  id: string;
  name: string;
  packageSlug: string | null;
};

export type OperatorHubVersion = {
  id: string;
  name: string;
  status: "live" | "draft";
};

export type OperatorHubSession = {
  id: string;
  title: string | null;
  userId: string | null;
  starterName: string | null;
};

type OperatorHubProps = {
  companyId: string;
  agents: OperatorHubAgent[];
  versions: OperatorHubVersion[];
  sessions: OperatorHubSession[];
  selectedAgentId: string | null;
  selectedVersionId: string | null;
  selectedChatId: string | null;
  canEdit: boolean;
};

export function OperatorHub({
  companyId,
  agents,
  versions,
  sessions,
  selectedAgentId,
  selectedVersionId,
  selectedChatId,
  canEdit,
}: OperatorHubProps) {
  const router = useRouter();

  function navigate(params: Record<string, string | undefined>) {
    const search = new URLSearchParams();
    const agentId = params.agentId ?? selectedAgentId;
    const versionId = params.versionId ?? selectedVersionId;
    const chatId = params.chatId;

    // A session link needs only its chat: the page reads agent and version from it.
    if (chatId) search.set("chatId", chatId);
    else {
      if (agentId) search.set("agentId", agentId);
      if (versionId) search.set("versionId", versionId);
    }

    const query = search.toString();
    router.push(query ? `/operator?${query}` : "/operator");
  }

  async function handleNewSession() {
    if (!selectedAgentId || !selectedVersionId) return;

    try {
      const result = await createOperatorSession({
        agentId: selectedAgentId,
        versionId: selectedVersionId,
      });
      navigate({ chatId: result.chatId });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create session",
      );
    }
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <MessageSquare className="size-5" />
        </div>
        <h3 className="mb-1 text-lg font-semibold tracking-tight">
          No operator agents yet
        </h3>
        <p className="mb-4 max-w-sm text-sm text-muted-foreground">
          {REVENUE_EMPTY_BODY}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <InstallPackageDialog
            companyId={companyId}
            variant="empty"
            leadEngineAgentId={null}
          />
          <CreateOperatorAgentDialog companyId={companyId} variant="ghost" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedAgentId ?? undefined}
          onValueChange={(agentId) => {
            navigate({ agentId, versionId: undefined, chatId: undefined });
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <span className="flex items-center gap-2">
                  {agent.name}
                  {agent.packageSlug === "revenue" ? (
                    <Chip asStatic>Revenue</Chip>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedVersionId ?? undefined}
          onValueChange={(versionId) =>
            navigate({ versionId, chatId: undefined })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Version" />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {version.name} · {version.status === "live" ? "LIVE" : "DRAFT"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={handleNewSession}
          disabled={!selectedAgentId || !selectedVersionId}
        >
          <Plus className="mr-2 h-4 w-4" />
          New session
        </Button>

        {canEdit && selectedAgentId && selectedVersionId && (
          <>
            <ForkVersionDialog
              agentId={selectedAgentId}
              versionId={selectedVersionId}
            />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/operator/agents/${selectedAgentId}`}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <InstallPackageDialog
            companyId={companyId}
            variant="toolbar"
            leadEngineAgentId={
              agents.find((agent) => agent.packageSlug === "lead-engine")?.id ??
              null
            }
          />
          <CreateOperatorAgentDialog companyId={companyId} variant="ghost" />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 rounded-lg border">
        <div className="w-64 shrink-0 border-r">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              Sessions
            </p>
          </div>
          <ScrollArea className="h-full">
            {sessions.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground text-center">
                No sessions yet. Start a new one.
              </p>
            ) : (
              <div className="p-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => navigate({ chatId: session.id })}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      session.id === selectedChatId && "bg-muted",
                    )}
                  >
                    <p className="font-medium truncate">
                      {session.title ?? "Untitled session"}
                    </p>
                    {session.starterName && (
                      <p className="text-xs text-muted-foreground truncate">
                        {session.starterName}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 min-w-0">
          {/* A selected session (?chatId) renders the session layout in operator-chat, not the hub. */}
          <div className="flex h-full flex-col items-center justify-center text-center p-8">
            <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Select a session</p>
            <p className="text-xs text-muted-foreground mt-1">
              Choose a session from the sidebar or start a new one.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
