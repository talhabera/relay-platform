import type { Metadata } from "next";

import { LivePage } from "./live-page";
import { parseLiveSearch } from "./live-model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Live" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Client portal Live (S72, Figma 11b `11/live/default`, `11/live/conversation-open`). */
export default async function ClientLivePage({ searchParams }: Props) {
  return <LivePage search={parseLiveSearch(await searchParams)} preview={false} />;
}
