import { redirect } from "next/navigation";

import { SETTINGS_INDEX_HREF } from "./settings-nav";

/** `/settings` has no page of its own; it opens Profile. */
export default function SettingsIndexPage() {
  redirect(SETTINGS_INDEX_HREF);
}
