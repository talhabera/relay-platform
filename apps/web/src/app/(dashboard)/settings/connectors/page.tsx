import { and, eq, inArray, isNull } from "drizzle-orm";
import { OAUTH_CONNECTOR_TYPES, OPERATOR_CONNECTOR_TYPES } from "@relay/db";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { requireCompanyAccess } from "@/lib/authorization";
import { NoCompanyState, PageRestricted } from "@/components/v2/shell";

import { resolveSettingsCompany } from "../active-company";
import { SettingsHeader } from "../settings-header";
import {
  connectorKeyHint,
  connectorRowState,
  gmailAccountNote,
  oauthConnectorRowState,
  type ConnectorListItem,
} from "./connector-view";
import { ConnectorsList } from "./connectors-list";
import { loadConnectorUsers } from "./connectors-data";

/** Figma 08c `connectors`: connectors of the active company. Owner-only. */
export default async function SettingsConnectorsPage() {
  const session = await requireSession();
  const { company: active, isOwner, ownsAny } = await resolveSettingsCompany(session.user.id);

  if (!active) {
    return <NoCompanyState isOwner={ownsAny} />;
  }
  if (!isOwner) {
    return (
      <div>
        <SettingsHeader title="Connectors" />
        <PageRestricted
          title="Connectors isn't available"
          description="Only the company owner manages connectors."
        />
      </div>
    );
  }

  const { company } = await requireCompanyAccess(active.id);
  const [rows, usedBy] = await Promise.all([
    db.query.integrations.findMany({
      where: and(
        eq(integrations.companyId, company.id),
        isNull(integrations.agentId),
        inArray(integrations.type, [...OPERATOR_CONNECTOR_TYPES, ...OAUTH_CONNECTOR_TYPES]),
      ),
    }),
    loadConnectorUsers(company.id),
  ]);

  // The stored config never leaves the server: only status, note and a last-4 hint do.
  const keyItems: ConnectorListItem[] = OPERATOR_CONNECTOR_TYPES.map((type) => {
    const row = rows.find((r) => r.type === type);
    const keyHint = row ? connectorKeyHint(type, row.config) : undefined;
    return { type, ...connectorRowState(row, keyHint), keyHint, usedBy };
  });
  // Google Workspace (S73): connected by Google sign-in; the note names the mailbox.
  const oauthItems: ConnectorListItem[] = OAUTH_CONNECTOR_TYPES.map((type) => {
    const row = rows.find((r) => r.type === type);
    return { type, ...oauthConnectorRowState(row, gmailAccountNote(row?.config ?? null)), usedBy };
  });
  const items = [...keyItems, ...oauthItems];

  return (
    <div>
      <SettingsHeader
        title="Connectors"
        description={`Accounts your operator agents use to find, check and contact leads for ${company.name}.`}
      />
      <ConnectorsList companyId={company.id} connectors={items} />
    </div>
  );
}
