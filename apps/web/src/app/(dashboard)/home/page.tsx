import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { resolvePagePermissions } from "@/lib/page-access";
import { isoWeekRange } from "@/lib/time";
import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";

import { NewSessionDialog } from "../operator/_overview/new-session-dialog";
import { weekRangeLabel } from "../operator/_overview/overview-model";
import { safeTimeZone } from "../operator/_sessions/sessions-list";
import { AgentMap } from "./_agent-map/agent-map";
import { BriefTile } from "./_home/brief-tile";
import {
  buildBriefTile,
  buildLeadEngineRows,
  buildTodayRows,
  homeDateLabel,
  homeGreeting,
  setupSteps,
  todayTitle,
} from "./_home/home-model";
import { HomeView, LeadEngineTile, NeedsYouTile, SetupCard, TodayTile } from "./_home/home-view";
import { loadHome } from "./_home/load-home";
import { AdReportTile } from "./_home/ad-report-tile";
import { MyTasksTile } from "./_home/my-tasks-tile";

/**
 * Logged-in home (Figma 04 `home/{default, member, empty}`). Never page-gated:
 * every signed-in user lands here and sees the Home tiles they qualify for.
 */
export default async function HomePage() {
  const session = await requireSession();
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);
  const companies = await listAccessibleCompanies(session.user.id);
  const company = companies.find((c) => c.id === resolveActiveCompanyId(prefs?.activeCompanyId, companies));
  if (!company) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={companies.some((c) => c.ownerId === session.user.id)} />
      </SystemStateFrame>
    );
  }

  const now = new Date();
  const timeZone = safeTimeZone(company.timezone);
  const isOwner = company.ownerId === session.user.id;
  const pagePermissions = await resolvePagePermissions(session.user.id, company);
  const data = await loadHome({
    companyId: company.id,
    ownerId: company.ownerId,
    viewerId: session.user.id,
    isOwner,
    pagePermissions,
    timeZone,
    now,
  });

  const date = homeDateLabel(now, timeZone);
  const week = weekRangeLabel(isoWeekRange(now, timeZone), timeZone).replace(/ \d{4}$/, "");
  const subtitle = data.empty
    ? `${date} · ${company.name} has no agents yet. Set it up in three steps.`
    : `${date} · ${company.name} this week, ${week}`;

  return (
    <HomeView
      greeting={homeGreeting({ name: session.user.name, now, timeZone, empty: data.empty })}
      subtitle={subtitle}
      canEdit={isOwner}
      newSession={
        data.sessionTargets ? <NewSessionDialog groups={data.sessionTargets} className="shrink-0" /> : null
      }
      tiles={data.tiles}
      kpis={data.kpis}
      leadTarget={data.leadTarget}
      needsYou={<NeedsYouTile data={data.needsYou} now={now} />}
      today={
        <TodayTile
          title={todayTitle(now, timeZone)}
          rows={data.today ? buildTodayRows({ ...data.today, now, timeZone }) : []}
        />
      }
      brief={
        data.brief ? (
          <BriefTile companyId={company.id} model={buildBriefTile({ ...data.brief, now, timeZone })} />
        ) : null
      }
      myTasks={data.myTasks ? <MyTasksTile model={data.myTasks} /> : null}
      adReport={data.tiles.includes("ad_report") ? <AdReportTile model={data.adReport} /> : null}
      agentMap={data.agentMap ? <AgentMap model={data.agentMap} /> : null}
      leadEngine={<LeadEngineTile rows={data.leadWorkflow ? buildLeadEngineRows(data.leadWorkflow) : null} />}
      setup={
        data.empty ? (
          <SetupCard
            companyName={company.name}
            steps={setupSteps({
              companyId: company.id,
              hasCustomerAgent: data.hasCustomerAgent,
              hasWorkflow: data.workflowCount > 0,
              hasConnector: false,
            })}
          />
        ) : undefined
      }
    />
  );
}
