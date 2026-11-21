import type { Metadata } from "next";

import { ClientNotificationList } from "@/components/v2/client";
import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";

import { ClientPortalHeader } from "../../portal-header";
import { setReportEmails } from "../actions";
import { loadClientNotificationsPage } from "../load-profile";
import { ReportEmailToggle } from "./report-email-toggle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Client Notifications (S107, spec client-role-and-portal decision 8): the report-email
 * opt-out (read by report email delivery, S88) and the same feed as the bell.
 */
export default async function ClientNotificationsPage() {
  const data = await loadClientNotificationsPage();

  if (data.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </SystemStateFrame>
    );
  }

  const { company, role, state } = data;
  const isClient = role === "client" && state.reportEmailOptOut !== null;

  return (
    <div className="min-h-svh bg-background">
      <ClientPortalHeader active={null} company={company} />
      <main className="flex w-full flex-col gap-5 px-4 pt-2 pb-12 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="type-h3 text-foreground">Notifications</h1>
          <p className="type-small text-muted-foreground">
            The bell shows new reports and handoff requests sent to you.
          </p>
        </header>
        <div className="flex max-w-xl flex-col gap-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <ReportEmailToggle
              enabled={isClient ? !state.reportEmailOptOut : null}
              save={isClient ? setReportEmails.bind(null, company.id) : undefined}
            />
          </section>
          <section aria-labelledby="recent-notifications" className="overflow-hidden rounded-xl border border-border bg-card">
            <h2 id="recent-notifications" className="border-b border-border px-4 py-3 type-body-strong text-foreground">
              Recent
            </h2>
            <ClientNotificationList items={state.items} />
          </section>
        </div>
      </main>
    </div>
  );
}
