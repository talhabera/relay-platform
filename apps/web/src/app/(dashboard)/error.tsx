"use client";

import { InAppError, SystemStateFrame } from "@/components/v2/shell/system-states";

/** Figma `03/error/in-app` (`530:74005`). */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SystemStateFrame>
      <InAppError digest={error.digest} onRetry={reset} />
    </SystemStateFrame>
  );
}
