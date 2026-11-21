import { permanentRedirect } from "next/navigation";

/** Moved to the Settings shell (S47). */
export default async function LegacyCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/settings/companies/${encodeURIComponent(id)}`);
}
