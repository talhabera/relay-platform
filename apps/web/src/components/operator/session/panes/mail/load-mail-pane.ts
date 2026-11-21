import { and, eq, isNull } from "drizzle-orm";
import { PACKAGE_CATALOG } from "@relay/db";

import { db } from "@/db";
import { integrations } from "@/db/schema";
import { isFixturesEnabled } from "@/lib/fixtures";

import { MAIL_FIXTURE_NOW, mailSequenceFixture } from "./mail-fixtures";
import type { MailPaneProps } from "./mail-pane";

const MAILER_NAME =
  PACKAGE_CATALOG.find((p) => p.slug === "lead-engine")?.agents.find((a) => a.key === "mailer")?.name ??
  "Mail Marketer";

/** Sessions that get the Mail work pane: the Lead engine's Mail Marketer. */
export function hasMailPane(agent: { packageSlug: string | null | undefined; name: string } | null | undefined): boolean {
  return agent?.packageSlug === "lead-engine" && agent.name === MAILER_NAME;
}

/** True when the company's Google Workspace (Gmail) connector is connected (S73). */
async function gmailConnected(companyId: string): Promise<boolean> {
  const row = await db.query.integrations.findFirst({
    columns: { status: true },
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.type, "google_workspace"),
      isNull(integrations.agentId),
    ),
  });
  return row?.status === "connected";
}

/**
 * Mail work pane props for a session the page already authorized (company
 * membership + operator access). The sequence model is phase 2 (map #31):
 * with RELAY_FIXTURES=true the pane shows the canon Acme sequence as if Gmail
 * were connected; otherwise it is the Connect state until Gmail connects, then
 * "No sequence yet".
 */
export async function loadMailPane(args: { companyId: string; canAct: boolean }): Promise<MailPaneProps> {
  if (isFixturesEnabled()) {
    return {
      gmailConnected: true,
      sequence: mailSequenceFixture,
      now: MAIL_FIXTURE_NOW.toISOString(),
      canAct: args.canAct,
    };
  }
  return {
    gmailConnected: await gmailConnected(args.companyId),
    sequence: null,
    now: new Date().toISOString(),
    canAct: args.canAct,
  };
}
