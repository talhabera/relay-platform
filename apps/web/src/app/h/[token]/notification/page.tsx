import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_TOKEN, QUICK_LINK_FIXTURES } from "../fixtures";
import { HandoffNotificationPreview } from "../notification";
import { formatClock } from "../screen";

export const metadata: Metadata = {
  title: "Handoff notification preview",
  robots: { index: false, follow: false },
};

/**
 * Dev-only fixture (Figma 11c `11/handoff/notification`): the WhatsApp
 * template message a recipient gets, at `/h/fixture/notification`, for visual
 * QA and e2e. Production returns 404.
 */
export default async function NotificationPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (process.env.NODE_ENV === "production" || token !== FIXTURE_TOKEN) notFound();
  const { request, company } = QUICK_LINK_FIXTURES.open;
  return (
    <HandoffNotificationPreview
      className="mx-auto max-w-[390px]"
      recipientName={request.recipientName}
      companyName={company.name}
      question={request.questions[0]?.text ?? ""}
      time={formatClock(request.createdAt, FIXTURE_TIME_ZONE) || formatClock(FIXTURE_NOW.toISOString(), FIXTURE_TIME_ZONE)}
      href={`/h/${FIXTURE_TOKEN}`}
    />
  );
}
