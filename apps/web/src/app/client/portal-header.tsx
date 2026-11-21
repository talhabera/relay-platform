import { ClientBell, ClientHeader, ClientUserMenu, type ClientHeaderProps } from "@/components/v2/client";
import { requireSession } from "@/lib/auth-server";
import { signOutAction } from "@/lib/auth-actions";
import { loadClientNotifications } from "@/lib/client/notifications-data";

import { markNotificationsSeen } from "./profile/actions";

type ClientPortalHeaderProps = Pick<ClientHeaderProps, "active" | "hrefs" | "className"> & {
  company: { id: string; name: string };
};

const VIEWER_LABELS = { client: "Client", member: "Member", owner: "Owner" } as const;

/**
 * Client header bound to the session (S107): portal bell (report ready, handoff requests to
 * this user) and the client user menu. Every `/client/*` page renders it after its own
 * `requireClientAccess`. `active` is null on Profile / Notifications (no tab lit).
 */
export async function ClientPortalHeader({ active, company, hrefs, className }: ClientPortalHeaderProps) {
  const session = await requireSession();
  const state = await loadClientNotifications(session.user.id, company.id);

  return (
    <ClientHeader
      active={active}
      company={company}
      hrefs={hrefs}
      className={className}
      bell={
        <ClientBell
          items={state.items}
          unread={state.unread}
          onOpen={state.viewer === "client" ? markNotificationsSeen.bind(null, company.id) : undefined}
        />
      }
      userMenu={
        <ClientUserMenu
          user={{ name: session.user.name, image: session.user.image }}
          meta={`${VIEWER_LABELS[state.viewer]} · ${company.name}`}
          onSignOut={signOutAction}
        />
      }
    />
  );
}
