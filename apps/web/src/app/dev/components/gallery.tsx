"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import {
  BindingRow,
  CanvasAgentCard,
  CanvasAgentNode,
  CanvasPort,
  CanvasSurface,
  ConnectorNode,
  HandoffNode,
  InspectorPanel,
  SourceNode,
  ToolToggleRow,
} from "@/components/v2/canvas";
import {
  ClientBell,
  ClientHeader,
  ClientNotificationList,
  ClientNotificationRow,
  ClientNotificationsPanel,
  ClientUserMenu,
  HandoffHeader,
  HandoffRequestCard,
  LiveEventRow,
  ReportHeader,
  type ClientNotificationItem,
} from "@/components/v2/client";
import {
  AccessMatrixRow,
  ChartCard,
  ChatDock,
  CompanyRow,
  ConnectorRow,
  InboxRow,
  MemberRow,
  TranscriptMessage,
} from "@/components/v2/data";
import { MarketingFooter, MarketingNav } from "@/components/v2/marketing";
import {
  AgentChip,
  BrandGlyph,
  brandGlyphNames,
  Chip,
  CountBadge,
  Icon,
  IconButton,
  iconMap,
  ProgressBar,
  ScoreRing,
  Segmented,
  StatusChip,
  type IconName,
  type StatusTone,
} from "@/components/v2/primitives";
import {
  AgentQuestion,
  ChatComposer,
  CheckpointCard,
  ConversationMessage,
  Message,
  SessionHeader,
  SessionRow,
  SteeringComposer,
  ToolChip,
  WorkPaneHeader,
} from "@/components/v2/session";
import {
  AppHeader,
  AuthCard,
  BrandLockup,
  BrandMark,
  CompanySwitcher,
  InAppError,
  InAppNotFound,
  NavPill,
  NoCompanyState,
  PageRestricted,
  PublicNotFound,
  SystemStateFrame,
  UserMenu,
} from "@/components/v2/shell";
import {
  CalendarPost,
  EmailStepCard,
  GoalStrip,
  LeadRow,
  LeadRowHeader,
  NeedsYouList,
  NeedsYouPanel,
  NeedsYouRow,
  PackageCard,
  ReviewCard,
  ScheduleRow,
  VersionTicket,
  WorkflowStageNode,
} from "@/components/v2/work";

/** Section ids, one per Figma page 02 `v2/*` section. The test keeps this in step with components/v2. */
export const GALLERY_SECTIONS = [
  "primitives",
  "shell",
  "session",
  "work",
  "canvas",
  "data",
  "client",
  "marketing",
] as const;

type SectionId = (typeof GALLERY_SECTIONS)[number];

const noop = () => {};

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  return (
    <section id={id} data-gallery-section={id} className="flex flex-col gap-6 border-t border-border pt-8">
      <h2 className="type-h2 text-foreground">v2/{id}</h2>
      {children}
    </section>
  );
}

function Specimen({ name, figma, width, children }: { name: string; figma?: string; width?: number; children: React.ReactNode }) {
  return (
    <div data-specimen={name} className="flex flex-col gap-2" style={width ? { width } : undefined}>
      <span className="type-caption text-muted-foreground">
        {name}
        {figma ? ` · ${figma}` : ""}
      </span>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

const STATUS_TONES: StatusTone[] = ["live", "draft", "pending", "needs-you", "success", "error", "neutral"];

function Primitives() {
  const [segment, setSegment] = useState("b");
  return (
    <Section id="primitives">
      <Specimen name="Icon/*">
        <div className="flex max-w-[960px] flex-wrap gap-3 text-foreground">
          {(Object.keys(iconMap) as IconName[]).map((name) => (
            <span key={name} title={name}>
              <Icon name={name} size={20} />
            </span>
          ))}
        </div>
      </Specimen>
      <Specimen name="Brand glyph" figma="size=16|24">
        <div className="flex flex-col gap-3">
          {([16, 24] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              {brandGlyphNames.map((brand) => (
                <BrandGlyph key={brand} brand={brand} size={size} label={brand} />
              ))}
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen name="Chip" figma="variant x size">
        {(["default", "selected", "steering"] as const).map((variant) => (
          <div key={variant} className="flex items-center gap-2">
            {(["sm", "md", "lg"] as const).map((size) => (
              <Chip key={size} variant={variant} size={size} icon="sparkles">
                {variant} {size}
              </Chip>
            ))}
          </div>
        ))}
      </Specimen>
      <Specimen name="Status chip">
        {STATUS_TONES.map((tone) => (
          <StatusChip key={tone} tone={tone} />
        ))}
      </Specimen>
      <Specimen name="Count badge">
        {(["neutral", "primary", "warning", "destructive"] as const).map((tone) => (
          <CountBadge key={tone} tone={tone} count={tone === "destructive" ? 120 : 4} />
        ))}
      </Specimen>
      <Specimen name="Icon button" figma="variant x size">
        {(["ghost", "outline", "filled"] as const).map((variant) => (
          <div key={variant} className="flex items-center gap-2">
            {(["sm", "md", "lg"] as const).map((size) => (
              <IconButton key={size} variant={variant} size={size} icon="bell" label={`${variant} ${size}`} dot={size === "md"} />
            ))}
          </div>
        ))}
      </Specimen>
      <Specimen name="Segmented control">
        <Segmented
          aria-label="Segmented 3"
          items={[
            { value: "a", label: "Versions" },
            { value: "b", label: "Tools" },
            { value: "c", label: "Schedules" },
          ]}
          value={segment}
          onValueChange={setSegment}
        />
      </Specimen>
      <Specimen name="Progress bar" width={320}>
        <div className="flex w-full flex-col gap-3">
          <ProgressBar value={62} aria-label="primary" />
          <ProgressBar value={88} tone="warning" aria-label="warning" />
        </div>
      </Specimen>
      <Specimen name="Score ring">
        <ScoreRing value={91} />
        <ScoreRing value={64} />
        <ScoreRing value={32} />
      </Specimen>
      <Specimen name="Agent chip">
        <AgentChip kind="operator" name="Researcher" version="v3" status="live" />
        <AgentChip kind="operator" name="Writer" version="v4" status="draft" />
        <AgentChip kind="customer" name="Front desk" />
      </Specimen>
    </Section>
  );
}

function Shell() {
  const companies = [
    { id: "c1", name: "Acme GmbH" },
    { id: "c2", name: "Isar Data" },
  ];
  return (
    <Section id="shell">
      <Specimen name="Brand mark / Brand lockup" figma="7:8 / 7:12">
        <BrandMark />
        <BrandLockup href={null} />
      </Specimen>
      <Specimen name="Nav pill" figma="375:22384">
        <NavPill href="#" icon="house" label="Home" />
        <NavPill href="#" icon="workflow" label="Operator" active />
      </Specimen>
      <Specimen name="App header · owner" figma="375:24991">
        <div className="w-full">
          <AppHeader
            role="owner"
            active="operator"
            unread
            companySwitcher={<CompanySwitcher companies={companies} activeCompanyId="c1" />}
            userMenu={<UserMenu role="owner" user={{ name: "Talha Bera" }} meta="Owner · Acme GmbH" />}
          />
        </div>
      </Specimen>
      <Specimen name="App header · member">
        <div className="w-full">
          <AppHeader
            role="member"
            active="home"
            companySwitcher={<CompanySwitcher companies={companies.slice(0, 1)} activeCompanyId="c1" />}
            userMenu={<UserMenu role="member" user={{ name: "Markus Weber" }} />}
          />
        </div>
      </Specimen>
      <Specimen name="Company switcher" figma="9:95 loading">
        <CompanySwitcher companies={companies} activeCompanyId="c1" loading />
      </Specimen>
      <Specimen name="Page restricted" figma="10:80" width={560}>
        <PageRestricted actionHref="#" />
      </Specimen>
      <Specimen name="Auth card" figma="03/sign-in" width={520}>
        <AuthCard title="Sign in to Relay" description="Use your NexStep account." />
      </Specimen>
      <Specimen name="Public not found" figma="530:1626" width={520}>
        <PublicNotFound />
      </Specimen>
      <Specimen name="In-app not found / error" figma="530:74005" width={600}>
        <InAppNotFound />
        <InAppError digest="a1b2c3" onRetry={() => {}} />
      </Specimen>
      <Specimen name="No company · owner / member" figma="378:24597 / 378:24723" width={600}>
        <SystemStateFrame>
          <NoCompanyState isOwner />
        </SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </Specimen>
    </Section>
  );
}

function Session() {
  const [composer, setComposer] = useState("");
  const [steer, setSteer] = useState("");
  const agent = { kind: "operator" as const, name: "Researcher", version: "v3", status: "live" as const };
  return (
    <Section id="session">
      <Specimen name="Session header" width={960}>
        <SessionHeader
          className="w-full"
          title="Find 40 facility managers in Munich"
          status="needs-you"
          crumbs={[{ label: "Workflows", href: "#" }, { label: "Lead engine", href: "#" }, { label: "Gather" }]}
          agent={agent}
          startedLabel="Started 09:12 by schedule"
        />
      </Specimen>
      <Specimen name="Session row" figma="default | selected" width={960}>
        <div className="flex w-full flex-col">
          <SessionRow
            href="#"
            status="running"
            title="Weekly outreach batch"
            workflow="Lead engine"
            agent={agent}
            startedBy={{ kind: "schedule", name: "Mon 09:00" }}
            started="09:00"
            lastActivity="2m ago"
            checkpoints={1}
          />
          <SessionRow
            href="#"
            selected
            status="failed"
            title="Qualify inbound leads"
            agent={agent}
            startedBy={{ kind: "person", name: "Talha Bera", initials: "TB" }}
            started="Yesterday"
            lastActivity="1h ago"
            checkpoints={0}
          />
        </div>
      </Specimen>
      <Specimen name="Conversation message" width={640}>
        <div className="flex w-full flex-col gap-4">
          <ConversationMessage role="operator" author="Talha Bera" initials="TB" time="09:14">
            Focus on companies with more than 50 staff.
          </ConversationMessage>
          <ConversationMessage
            role="agent"
            author="Researcher"
            version="v3"
            time="09:15"
            tools={[
              { label: "Google Places", state: "done", detail: "48 results" },
              { label: "Enrich", state: "running" },
            ]}
          >
            Found 48 candidates; enriching contacts now.
          </ConversationMessage>
          <ConversationMessage role="agent" author="Researcher" state="error" errorReason="Rate limited" onRetry={noop}>
            Partial reply
          </ConversationMessage>
        </div>
      </Specimen>
      <Specimen name="Tool chip">
        <ToolChip label="Google Places" state="running" />
        <ToolChip label="Enrich" state="done" detail="12 contacts" />
        <ToolChip label="Send email" state="failed" />
      </Specimen>
      <Specimen name="Agent question" figma="open | answered" width={640}>
        <div className="flex w-full flex-col gap-4">
          <AgentQuestion
            state="open"
            question="Should borderline leads (score 65-69) go to outreach?"
            context="3 leads this run"
            askedBy="Qualifier"
            askedAt="09:20"
            replies={["Yes", "No, keep them in Borderline"]}
            onReply={noop}
          />
          <AgentQuestion
            state="answered"
            question="Should borderline leads go to outreach?"
            askedBy="Qualifier"
            answer={{ reply: "No, keep them in Borderline", by: "Talha Bera", at: "09:22" }}
          />
        </div>
      </Specimen>
      <Specimen name="Checkpoint card" figma="7 states">
        {(["pending", "changes-requested", "approved", "discarded", "failed", "stale", "read-only"] as const).map((state) => (
          <div key={state} className="w-[420px]">
            <CheckpointCard
              state={state}
              title="Send 12 intro emails"
              meta="Writer v4 · 2m ago"
              changeRequest="Shorter subject lines"
              revisingNote="Writer is revising"
              result="12 sent"
              onApprove={noop}
              onAskForChanges={noop}
              onDiscard={noop}
              onRetry={noop}
              onRefresh={noop}
            />
          </div>
        ))}
      </Specimen>
      <Specimen name="Steering composer" width={640}>
        <div className="flex w-full flex-col gap-3">
          <SteeringComposer
            value={steer}
            onChange={setSteer}
            onSubmit={noop}
            chips={[{ label: "Pause", icon: "pause" }, { label: "Skip this lead" }]}
            quote={{ label: "Ask for changes · Checkpoint", text: "Send 12 intro emails" }}
            onRemoveQuote={noop}
          />
          <SteeringComposer value="" onChange={noop} onSubmit={noop} disabled />
        </div>
      </Specimen>
      <Specimen name="Work pane header" width={640}>
        <WorkPaneHeader className="w-full" title="Intro sequence" meta="3 steps · draft" />
      </Specimen>
      <Specimen name="Message" figma="widget | transcript x states" width={640}>
        <div className="flex w-full flex-col gap-3">
          <Message role="user" view="widget">
            Do you clean on weekends?
          </Message>
          <Message role="assistant" view="widget" state="streaming">
            Yes, we offer
          </Message>
          <Message role="user" view="transcript" author="Lukas Brenner" time="10:02" source="whatsapp" state="error">
            Hello?
          </Message>
        </div>
      </Specimen>
      <Specimen name="Chat composer" figma="centered | docked" width={720}>
        <div className="flex w-full flex-col gap-4">
          <ChatComposer
            mode="centered"
            heading="What should we work on?"
            value={composer}
            onChange={setComposer}
            onSubmit={noop}
            suggestions={["Find leads", "Draft a post"]}
            onSuggestion={noop}
            paperclip="disabled"
          />
          <ChatComposer mode="docked" value="" onChange={noop} onSubmit={noop} disabled />
        </div>
      </Specimen>
    </Section>
  );
}

function Work() {
  const needsYou = [
    {
      id: "n1",
      kind: "checkpoint" as const,
      title: "Approve 12 intro emails",
      workflow: "Lead engine",
      impact: "44 qualified leads wait for outreach",
      agent: "Writer",
      age: "7m ago",
      href: "#",
    },
    { id: "n2", kind: "question" as const, title: "Borderline leads?", agent: "Qualifier", age: "1h ago", href: "#" },
    { id: "n3", kind: "failed-run" as const, title: "Gather failed", agent: "Researcher", age: "3h ago", href: "#" },
  ];
  return (
    <Section id="work">
      <Specimen name="Needs you row" width={560}>
        <NeedsYouRow {...needsYou[0]} />
      </Specimen>
      <Specimen name="Needs you panel" width={420}>
        <NeedsYouPanel items={needsYou} total={5} viewAllHref="#" operatorHref="#" />
      </Specimen>
      <Specimen name="Needs you list" width={448}>
        <NeedsYouList items={needsYou} filterHref="#" />
      </Specimen>
      <Specimen name="Goal strip" width={1040}>
        <GoalStrip className="w-full" weekLabel="Week 40" delivered={18} target={25} quality={78} costPerLead="$4.10" />
      </Specimen>
      <Specimen name="Workflow stage node">
        <WorkflowStageNode stage="Gather" agent={{ name: "Researcher", version: "v3", status: "live" }} count="48 found" />
        <WorkflowStageNode
          stage="Qualify"
          agent={{ name: "Qualifier", version: "v2", status: "live" }}
          count="12 qualified"
          state="needs_you"
          pending={2}
        />
        <WorkflowStageNode stage="Outreach" agent={null} count="—" state="idle" />
      </Specimen>
      <Specimen name="Schedule row" figma="default | compact" width={960}>
        <div className="flex w-full flex-col">
          <ScheduleRow
            name="Weekly gather"
            workflow="Lead engine · Gather"
            agent={{ name: "Researcher", version: "v3", status: "live" }}
            cadence="Mon 09:00"
            nextRun="in 2 days"
            lastResult="success"
            approval="Checkpoint before send"
            lastRunHref="#"
            lastRunLabel="Last run"
          />
          <ScheduleRow
            density="compact"
            name="Daily qualify"
            workflow="Lead engine · Qualify"
            agent={{ name: "Qualifier" }}
            cadence="Daily 08:00"
            nextRun="tomorrow"
            lastResult="error"
            approval="Auto"
          />
        </div>
      </Specimen>
      <Specimen name="Lead row" width={1040}>
        <div className="flex w-full flex-col">
          <LeadRowHeader />
          <LeadRow
            company="Isar Data GmbH"
            companyMeta="Munich · 120 staff"
            contactName="Lukas Brenner"
            contactMeta="Facility manager"
            fitScore={88}
            reasons={["Office > 1,000 m²", "Weekend need"]}
          />
          <LeadRow company="Brenner Bau" contactName={null} fitScore={72} reasons={["Close fit"]} borderline selected />
          <LeadRow company="Kiosk 24" contactName="Ana" fitScore={41} reasons={["Too small"]} />
        </div>
      </Specimen>
      <Specimen name="Email step card" width={720}>
        <EmailStepCard
          className="w-full"
          stepNumber={1}
          day="Day 0"
          subject="Weekend cleaning for Isar Data"
          expanded
          previewOptions={[{ value: "lukas", label: "Lukas Brenner" }]}
          previewValue="lukas"
          body={[[{ text: "Hi Lukas, " }, { text: "we noticed", change: "delete" }, { text: "your office", change: "insert" }]]}
          checks={[{ label: "Spam score", metric: "1.2", detail: "Good, low risk", ok: true }]}
        />
      </Specimen>
      <Specimen name="Calendar post">
        <CalendarPost title="Spring offer" platform="instagram" />
        <CalendarPost title="Team intro" platform="linkedin" status="needs-review" />
        <CalendarPost title="Tips" platform="facebook" status="draft" />
      </Specimen>
      <Specimen name="Review card" width={640}>
        <ReviewCard
          className="w-full"
          source="google"
          rating={2}
          author="M. Huber"
          date="2 Oct"
          text="Cleaners arrived late twice."
          sentiment="negative"
          replyStatus="drafted"
          reply="Sorry about that, we have changed the schedule."
          needsApproval
          expanded
        />
      </Specimen>
      <Specimen name="Package card" figma="installed | available | needs-connector">
        {(["installed", "available", "needs-connector"] as const).map((state) => (
          <div key={state} className="w-[360px]">
            <PackageCard
              state={state}
              name="Lead engine"
              tagline="Find, qualify and contact B2B leads"
              adds={{ agents: 3, workflows: 1, schedules: 2 }}
              connectors={[
                { brand: "google-workspace", name: "Gmail", state: state === "needs-connector" ? "missing" : "connected" },
                { brand: "whatsapp", name: "WhatsApp", state: "optional" },
              ]}
              installedLabel="Installed 1 Oct"
              actionLabel={state === "installed" ? "Open" : "Install"}
              onAction={noop}
            />
          </div>
        ))}
      </Specimen>
      <Specimen name="Version ticket">
        <VersionTicket version="v3" status="live" title="Tighter rubric" note="Live since 1 Oct" />
        <VersionTicket version="v4" status="draft" title="Weekend focus" selected />
      </Specimen>
    </Section>
  );
}

function Canvas() {
  const metrics: [{ value: string; label: string }, { value: string; label: string }] = [
    { value: "48", label: "Runs" },
    { value: "96%", label: "Success" },
  ];
  return (
    <Section id="canvas">
      <Specimen name="Canvas agent card" figma="default | selected | paused | error">
        {(["default", "selected", "paused", "error"] as const).map((state) => (
          <div key={state} className="w-[320px]">
            <CanvasAgentCard
              kind="operator"
              name="Researcher"
              description="Finds facility managers"
              model="Sonnet"
              version="v3"
              state={state}
              metrics={metrics}
              glyphs={["google-places", "email"]}
              alert="Google Places quota reached · 06:00"
            />
          </div>
        ))}
      </Specimen>
      <Specimen name="Canvas agent node" figma="04 agent map: operator | customer | paused">
        <CanvasAgentNode kind="operator" name="Lead Gatherer" eyebrow="Claude Haiku" icon="user" status={{ tone: "live", label: "v1 Live" }} />
        <CanvasAgentNode kind="customer" name="Acme Website Assistant" eyebrow="Customer agent" status={{ tone: "live", label: "Live" }} />
        <CanvasAgentNode kind="operator" name="Market Analyst" eyebrow="Claude Opus" icon="trending-up" state="paused" status={{ tone: "neutral", label: "Paused" }} />
      </Specimen>
      <Specimen name="Source node">
        <SourceNode source="website" />
        <SourceNode source="whatsapp" state="disconnected" onConnect={noop} />
        <SourceNode source="instagram" state="error" statusText="Token expired" />
      </Specimen>
      <Specimen name="Connector node">
        <ConnectorNode brand="google-workspace" name="Gmail" />
        <ConnectorNode brand="google-places" name="Google Places" status="error" />
        <ConnectorNode brand="hunter" name="Hunter" status="pending" />
      </Specimen>
      <Specimen name="Handoff node" figma="default | selected">
        <HandoffNode recipient="Markus Weber" channel={{ brand: "whatsapp", label: "WhatsApp" }} expiry="15 min" fallback="Agent apologises" />
        <HandoffNode state="selected" recipient="Team chat" expiry="30 min" fallback="Email follow-up" />
      </Specimen>
      <Specimen name="Canvas port">
        {(["idle", "active", "pending", "error"] as const).map((tone) => (
          <span key={tone} className="relative inline-flex h-6 w-10 items-center">
            <CanvasPort side="right" tone={tone} />
          </span>
        ))}
      </Specimen>
      <Specimen name="Binding row" width={560}>
        <div className="flex w-full flex-col">
          <BindingRow source="website" name="acme.de" agent="Front desk" />
          <BindingRow source="whatsapp" agent="Front desk" status="paused" />
          <BindingRow source="instagram" agent="Front desk" status="error" />
        </div>
      </Specimen>
      <Specimen name="Tool toggle row" width={400}>
        <div className="flex w-full flex-col">
          <ToolToggleRow label="Web search" icon="globe" state="on" />
          <ToolToggleRow label="Send email" icon="mail" state="off" />
          <ToolToggleRow label="Calendar" icon="calendar" state="coming-soon" />
        </div>
      </Specimen>
      <Specimen name="Inspector panel" figma="operator | customer">
        <InspectorPanel
          kind="operator"
          name="Researcher"
          description="Finds facility managers"
          version="v3"
          versionStatus="live"
          tab="tools"
          sectionLabel="Tools"
          onClose={noop}
          primaryAction={{ label: "Publish" }}
          secondaryAction={{ label: "Discard" }}
        >
          <ToolToggleRow label="Web search" icon="globe" state="on" />
        </InspectorPanel>
        <InspectorPanel kind="customer" name="Front desk" status={{ tone: "live", label: "Live" }} tab="sources" />
      </Specimen>
      <Specimen name="Canvas surface" width={1040}>
        <CanvasSurface
          className="h-[420px] w-full"
          listColumn="agents"
          selectedId="a1"
          columns={[
            { id: "sources", title: "Sources", nodes: [{ id: "s1", label: "Website", node: <SourceNode source="website" /> }] },
            {
              id: "agents",
              title: "Agents",
              nodes: [
                {
                  id: "a1",
                  label: "Front desk",
                  node: <CanvasAgentCard kind="customer" name="Front desk" model="Haiku" metrics={metrics} state="selected" />,
                },
              ],
            },
            { id: "connectors", title: "Connectors", nodes: [{ id: "c1", label: "Gmail", node: <ConnectorNode brand="google-workspace" name="Gmail" /> }] },
          ]}
          edges={[
            { from: "s1", to: "a1", tone: "active" },
            { from: "a1", to: "c1" },
          ]}
        />
      </Specimen>
    </Section>
  );
}

function Data() {
  const [dockDraft, setDockDraft] = useState("");
  const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const series = [4, 7, 5, 9, 12, null, 8];
  return (
    <Section id="data">
      <Specimen name="Chart card" figma="line | bar | funnel | donut">
        <div className="w-[480px]">
          <ChartCard
            title="Qualified leads"
            info="Per day"
            value="45"
            delta="+12%"
            comparison="vs last week"
            data={{ type: "line", points: week.map((label, i) => ({ label, value: series[i] })) }}
          />
        </div>
        <div className="w-[480px]">
          <ChartCard
            title="Conversations"
            value="312"
            data={{ type: "bar", points: week.map((label, i) => ({ label, value: (series[i] ?? 0) * 6 })), highlightIndex: 4 }}
          />
        </div>
        <div className="w-[480px]">
          <ChartCard
            title="Lead funnel"
            value="18 delivered"
            data={{
              type: "funnel",
              stages: [
                { label: "Gathered", value: 120 },
                { label: "Qualified", value: 45, note: "38%" },
                { label: "Delivered", value: 18 },
              ],
            }}
          />
        </div>
        <div className="w-[480px]">
          <ChartCard
            title="Channels"
            value="312"
            data={{
              type: "donut",
              centerLabel: "Total",
              centerValue: "312",
              segments: [
                { label: "Website", value: 160 },
                { label: "WhatsApp", value: 102 },
                { label: "Instagram", value: 50 },
              ],
            }}
          />
        </div>
      </Specimen>
      <Specimen name="Inbox row" figma="default | selected | unread | escalated" width={480}>
        <div className="flex w-full flex-col">
          <InboxRow customer="Lukas Brenner" source="whatsapp" time="10:02" agent="Front desk" snippet="Do you clean on weekends?" />
          <InboxRow state="selected" customer="Ana Silva" time="09:40" agent="Front desk" snippet="Thanks!" />
          <InboxRow state="unread" customer="M. Huber" source="instagram" time="09:12" agent="Front desk" snippet="Price for 800 m²?" />
          <InboxRow state="escalated" handoff handoffState="handed-off" customer="Isar Data" time="Yesterday" agent="Front desk" snippet="Weekend rate?" />
        </div>
      </Specimen>
      <Specimen name="Transcript message" width={640}>
        <div className="flex w-full flex-col gap-3">
          <TranscriptMessage role="user" author="Lukas Brenner" time="10:02" source="whatsapp" text="Do you clean on weekends?" />
          <TranscriptMessage role="assistant" author="Front desk" time="10:02" text="Yes, Saturdays and Sundays." />
        </div>
      </Specimen>
      <Specimen name="Access matrix row" width={1040}>
        <div className="flex w-full flex-col">
          <AccessMatrixRow variant="header" />
          <AccessMatrixRow variant="owner" name="Talha Bera" email="talha@acme.de" role="Owner" />
          <AccessMatrixRow variant="member" name="Markus Weber" email="markus@acme.de" role="Member" access={{ operator: true }} canApprove />
        </div>
      </Specimen>
      <Specimen name="Member row" width={720}>
        <div className="flex w-full flex-col">
          <MemberRow name="Markus Weber" email="markus@acme.de" role="Member" lastActive="2h ago" onMenu={noop} />
          <MemberRow status="invited" name="ana@acme.de" email="ana@acme.de" role="Member" />
        </div>
      </Specimen>
      <Specimen name="Connector row" figma="connected | disconnected | pending | error" width={720}>
        <div className="flex w-full flex-col">
          {(["connected", "disconnected", "pending", "error"] as const).map((status) => (
            <ConnectorRow key={status} status={status} brand="google-workspace" name="Gmail" description="Send outreach email" menu={status === "connected"} />
          ))}
        </div>
      </Specimen>
      <Specimen name="Company row" width={720}>
        <div className="flex w-full flex-col">
          <CompanyRow state="current" name="Acme GmbH" description="Cleaning, Munich" role="Owner" meta="3 agents" />
          <CompanyRow name="Isar Data" role="Member" onSwitch={noop} onMenu={noop} />
        </div>
      </Specimen>
      <Specimen name="Chat dock" figma="collapsed | expanded">
        <ChatDock state="collapsed" agentName="Researcher" version="v3" versionStatus="live" messageCount={4} onExpand={noop} />
        <div className="w-[400px]">
          <ChatDock state="expanded" agentName="Researcher" version="v4" versionStatus="draft" onMinimize={noop} onClose={noop} draft={dockDraft} onDraftChange={setDockDraft} onSend={noop}>
            <Message role="assistant" view="widget">
              Ready when you are.
            </Message>
          </ChatDock>
        </div>
      </Specimen>
    </Section>
  );
}

function Client() {
  const card = {
    question: "Can we offer weekend cleaning for 1,200 m², twice a week, from Mon 5 Oct?",
    reason: "Why you: weekend rates are not in the price list.",
    customer: "Lukas Brenner · Isar Data GmbH",
  };
  const replies = ["Yes, send the weekend rate", "Ask for their floor plan first", "I'll call them today"];
  const notifications: ClientNotificationItem[] = [
    {
      id: "report:r1",
      kind: "report_ready",
      title: "Daily report ready",
      detail: "Fri 2 Oct",
      at: "2026-10-02T22:05:00.000Z",
      when: "3 Oct, 00:05",
      href: "#",
      unread: true,
    },
    {
      id: "handoff:h1",
      kind: "handoff_request",
      title: "Handoff request: waiting for you",
      detail: "Can we offer weekend cleaning for 1,200 m², twice a week?",
      at: "2026-10-02T09:00:00.000Z",
      when: "2 Oct, 11:00",
      href: "#",
      unread: false,
    },
  ];
  return (
    <Section id="client">
      <Specimen name="Client header" figma="reports | live" width={1040}>
        <div className="flex w-full flex-col gap-3">
          <ClientHeader active="reports" company={{ id: "c1", name: "Acme GmbH" }} />
          <ClientHeader active="live" company={{ id: "c1", name: "Acme GmbH" }} unread />
          <ClientHeader
            active={null}
            company={{ id: "c1", name: "Acme GmbH" }}
            bell={<ClientBell items={notifications} unread />}
            userMenu={<ClientUserMenu user={{ name: "Markus Albrecht" }} meta="Client · Acme GmbH" />}
          />
        </div>
      </Specimen>
      <Specimen name="Client notifications" figma="bell panel | row | empty" width={1040}>
        <div className="flex w-full flex-wrap items-start gap-4">
          <ClientNotificationsPanel items={notifications} />
          <div className="w-100 rounded-xl border border-border">
            <ClientNotificationRow item={notifications[1]} />
            <ClientNotificationList items={[]} />
          </div>
        </div>
      </Specimen>
      <Specimen name="Report header" figma="daily | weekly | monthly" width={1040}>
        <div className="flex w-full flex-col gap-3">
          {(["daily", "weekly", "monthly"] as const).map((period) => (
            <ReportHeader key={period} period={period} range="28 Sep – 4 Oct" delivery="Sent Mondays 08:00" archiveHref="#" />
          ))}
        </div>
      </Specimen>
      <Specimen name="Handoff request card" figma="5 states x desktop">
        {(["open", "answered", "expired", "taken-over", "handed-back"] as const).map((state) => (
          <div key={state} className="w-[358px]">
            <HandoffRequestCard
              state={state}
              {...card}
              source="whatsapp"
              waitingText="Waiting 4 min"
              suggestedReplies={replies}
              onReply={noop}
              onHandBack={noop}
              onTakeOverAgain={noop}
            />
          </div>
        ))}
      </Specimen>
      <Specimen name="Handoff request card · mobile" width={358}>
        <HandoffRequestCard state="open" size="mobile" {...card} suggestedReplies={replies} onReply={noop} onHandBack={noop} />
      </Specimen>
      <Specimen name="Handoff header" figma="mobile | desktop">
        <div className="w-[390px]">
          <HandoffHeader company="Acme GmbH" linkText="Link expires in 12 min" onBack={noop} onMore={noop} />
        </div>
        <div className="w-[720px]">
          <HandoffHeader size="desktop" company="Acme GmbH" linkText="Link expires in 12 min" onTakeOver={noop} />
        </div>
      </Specimen>
      <Specimen name="Live event row" figma="lead | booking | handoff | review | conversation" width={640}>
        <div className="flex w-full flex-col">
          {(["lead", "booking", "handoff", "review", "conversation"] as const).map((kind) => (
            <LiveEventRow key={kind} kind={kind} time="10:02" text={`New ${kind}`} detail="Isar Data GmbH" />
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

function Marketing() {
  return (
    <Section id="marketing">
      <Specimen name="Marketing nav" width={1040}>
        <MarketingNav className="w-full" requestAccessHref="#" />
      </Specimen>
      <Specimen name="Marketing footer" width={1040}>
        <MarketingFooter className="w-full" year={2026} />
      </Specimen>
    </Section>
  );
}

function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("theme");
    if (forced === "light" || forced === "dark") setTheme(forced);
  }, [setTheme]);
  return (
    <Segmented
      aria-label="Theme"
      items={[
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ]}
      value={resolvedTheme ?? "dark"}
      onValueChange={setTheme}
    />
  );
}

export function ComponentGallery() {
  return (
    <main className="min-h-screen bg-background px-8 py-8 text-foreground">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="type-h1">Component gallery</h1>
            <p className="type-body text-muted-foreground">
              Figma page 02 v2 sections, for visual QA. Dev only.{" "}
              {GALLERY_SECTIONS.map((id) => (
                <a key={id} href={`#${id}`} className="mr-2 underline">
                  {id}
                </a>
              ))}
            </p>
          </div>
          <ThemeSwitch />
        </header>
        <Primitives />
        <Shell />
        <Session />
        <Work />
        <Canvas />
        <Data />
        <Client />
        <Marketing />
      </div>
    </main>
  );
}
