import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { channels, integrations, knowledgeBase } from "@/db/schema";
import { requireAgentAccess } from "@/lib/authorization";
import { toChannelView, toIntegrationView } from "@/lib/client-views";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CountBadge, SegmentedTabs, StatusChip } from "@/components/v2/primitives";
import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { KnowledgeTab } from "@/components/agent/knowledge-tab";
import { ChannelsTab } from "@/components/agent/channels-tab";
import { IntegrationsTab } from "@/components/agent/integrations-tab";
import { TestChatTab } from "@/components/agent/test-chat-tab";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { agent } = await requireAgentAccess(id);
  if (!agent) {
    notFound();
  }

  if (agent.kind === "operator") {
    notFound();
  }

  // Fetch related data in parallel
  const [agentChannels, agentIntegrations, agentKnowledge] = await Promise.all([
    db.query.channels.findMany({
      where: eq(channels.agentId, agent.id),
      orderBy: (channels, { desc }) => [desc(channels.createdAt)],
    }),
    db.query.integrations.findMany({
      where: eq(integrations.companyId, agent.companyId),
      orderBy: (integrations, { desc }) => [desc(integrations.createdAt)],
    }),
    db.query.knowledgeBase.findMany({
      where: eq(knowledgeBase.agentId, agent.id),
      orderBy: (knowledgeBase, { desc }) => [desc(knowledgeBase.createdAt)],
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name}
        description={agent.description ?? "Channels, knowledge, and widget."}
        badge={
          <StatusChip tone={agent.isActive ? "live" : "neutral"}>
            {agent.isActive ? "Active" : "Inactive"}
          </StatusChip>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/agents/${agent.id}/leads`}>Leads</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/agents">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to agents
              </Link>
            </Button>
          </div>
        }
      />

      <SegmentedTabs
        aria-label="Agent sections"
        defaultValue="run"
        contentClassName="mt-6"
        items={[
          {
            value: "run",
            label: "Run",
            content: (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
                <AgentSettingsForm agent={agent} />
                <TestChatTab
                  agentId={agent.id}
                  agentName={agent.name}
                  companyId={agent.companyId}
                />
              </div>
            ),
          },
          {
            value: "knowledge",
            label: <TabLabel text="Knowledge" count={agentKnowledge.length} />,
            content: (
              <KnowledgeTab
                agentId={agent.id}
                agentName={agent.name}
                companyId={agent.companyId}
                entries={agentKnowledge}
              />
            ),
          },
          {
            value: "channels",
            label: <TabLabel text="Channels" count={agentChannels.length} />,
            content: (
              <ChannelsTab
                agentId={agent.id}
                channels={agentChannels.map(toChannelView)}
              />
            ),
          },
          {
            value: "integrations",
            label: (
              <TabLabel text="Integrations" count={agentIntegrations.length} />
            ),
            content: (
              <IntegrationsTab
                companyId={agent.companyId}
                agentId={agent.id}
                integrations={agentIntegrations.map(toIntegrationView)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {count > 0 ? <CountBadge count={count} /> : null}
    </span>
  );
}
