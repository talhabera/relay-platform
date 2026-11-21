// Canon fixture for the Calendar work pane (05 session-calendar/default):
// Acme GmbH, "October content calendar", Social Media Manager v1.
// The content calendar model is phase 2 (map #31); until it lands the pane
// reads these posts while RELAY_FIXTURES=true.

import type { ContentCalendar } from "./calendar-pane-model";

export const contentCalendarFixture: ContentCalendar = {
  month: "2026-10",
  posts: [
    { id: "fx-post-01", date: "2026-10-01", title: "Deep-clean tips", platform: "instagram", status: "scheduled" },
    { id: "fx-post-05", date: "2026-10-05", title: "Crew training", platform: "linkedin", status: "scheduled" },
    { id: "fx-post-07", date: "2026-10-07", title: "Office refresh", platform: "facebook", status: "scheduled" },
    { id: "fx-post-09", date: "2026-10-09", title: "Brandt Logistik", platform: "linkedin", status: "needs-review" },
    { id: "fx-post-12", date: "2026-10-12", title: "Eco products", platform: "instagram", status: "scheduled" },
    { id: "fx-post-14", date: "2026-10-14", title: "Augsburg crew", platform: "facebook", status: "needs-review" },
    { id: "fx-post-16", date: "2026-10-16", title: "Autumn offer", platform: "instagram", status: "scheduled" },
    { id: "fx-post-20", date: "2026-10-20", title: "Before/after", platform: "instagram", status: "scheduled" },
    { id: "fx-post-22", date: "2026-10-22", title: "Q3 in numbers", platform: "linkedin", status: "needs-review" },
    { id: "fx-post-26", date: "2026-10-26", title: "Winter windows", platform: "facebook", status: "scheduled" },
    { id: "fx-post-28", date: "2026-10-28", title: "Night shift", platform: "instagram", status: "scheduled" },
    { id: "fx-post-30", date: "2026-10-30", title: "November slots", platform: "facebook", status: "scheduled" },
  ],
};
