"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/v2/primitives/icon";
import { AuthCard } from "@/components/v2/shell/system-states";

/** Figma `03/error/global` (`538:76509`): the root layout itself failed. */
export function GlobalErrorCard({ onReload }: { onReload: () => void }) {
  return (
    <AuthCard
      title="Relay is not responding"
      description="We could not load the app. Check your connection and try again."
    >
      <div className="flex justify-center">
        <Button onClick={onReload}>
          <Icon name="refresh-cw" size={16} />
          Reload
        </Button>
      </div>
    </AuthCard>
  );
}
