import { permanentRedirect } from "next/navigation";

/** Moved to the Settings shell (S47). */
export default function LegacyCompaniesPage() {
  permanentRedirect("/settings/companies");
}
