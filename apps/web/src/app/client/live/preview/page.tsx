import type { Metadata } from "next";

import { LivePage } from "../live-page";
import { parseLiveSearch } from "../live-model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Live · client portal preview" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Owner / member read-only preview of Live (Figma 11b `11/live/preview` `695:87269`). */
export default async function ClientLivePreviewPage({ searchParams }: Props) {
  return <LivePage search={parseLiveSearch(await searchParams)} preview />;
}
