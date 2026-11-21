import { Fragment, createElement as h, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  const Passthrough = ({ children }: { children?: ReactNode }) => h(Fragment, null, children);
  return { ...actual, DropdownMenu: { ...actual.DropdownMenu, Portal: Passthrough } };
});

import {
  CLIENT_USER_MENU_HREFS,
  ClientBell,
  ClientHeader,
  ClientNotificationList,
  ClientNotificationsPanel,
  ClientUserMenu,
  clientBellLabel,
  type ClientNotificationItem,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const count = (html: string, needle: string) => html.split(needle).length - 1;

const items: ClientNotificationItem[] = [
  {
    id: "report:r1",
    kind: "report_ready",
    title: "Daily report ready",
    detail: "Fri 2 Oct",
    at: "2026-10-02T22:05:00.000Z",
    when: "3 Oct, 00:05",
    href: "/client/reports?period=daily&id=r1",
    unread: true,
  },
  {
    id: "handoff:h1",
    kind: "handoff_request",
    title: "Handoff request: waiting for you",
    detail: "Can we offer weekend cleaning?",
    at: "2026-10-02T09:00:00.000Z",
    when: "2 Oct, 11:00",
    href: "/client/live",
    unread: false,
  },
];

describe("Client user menu (decision 4)", () => {
  it("has Profile, Notifications, Sign out and no Settings or Preferences", () => {
    const html = render(
      h(ClientUserMenu, { user: { name: "Markus Albrecht" }, meta: "Client · Acme GmbH", open: true }),
    );
    for (const label of ["Profile", "Notifications", "Sign out", "Client · Acme GmbH", ">MA<"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Preferences");
    expect(count(html, 'data-slot="user-menu-item"')).toBe(3);
    expect(html).toContain(`href="${CLIENT_USER_MENU_HREFS.profile}"`);
    expect(html).toContain(`href="${CLIENT_USER_MENU_HREFS.notifications}"`);
  });
});

describe("Client bell", () => {
  it("shows the dot only when unread and names the count", () => {
    expect(render(h(ClientBell, { items, unread: true }))).toContain('data-slot="icon-button-dot"');
    expect(render(h(ClientBell, { items, unread: false }))).not.toContain('data-slot="icon-button-dot"');
    expect(render(h(ClientBell, { items, unread: true }))).toContain('aria-label="Notifications: 1 new"');
    expect(clientBellLabel(0)).toBe("Notifications");
  });

  it("drops into the Client header bell slot", () => {
    const html = render(
      h(ClientHeader, {
        active: "reports",
        company: { id: "c1", name: "Acme GmbH" },
        bell: h(ClientBell, { items, unread: true }),
      }),
    );
    expect(count(html, 'aria-label="Notifications: 1 new"')).toBe(1);
  });
});

describe("Client notifications list + panel", () => {
  it("renders report-ready and handoff rows with links and an unread dot", () => {
    const html = render(h(ClientNotificationsPanel, { items }));
    expect(count(html, 'data-slot="client-notification-row"')).toBe(2);
    expect(html).toContain('href="/client/reports?period=daily&amp;id=r1"');
    expect(html).toContain('href="/client/live"');
    expect(count(html, 'data-slot="client-notification-dot"')).toBe(1);
    expect(html).toContain('data-icon="hand-helping"');
    expect(html).toContain('href="/client/profile/notifications"');
  });

  it("has an empty state", () => {
    const html = render(h(ClientNotificationList, { items: [] }));
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No notifications yet");
  });
});
