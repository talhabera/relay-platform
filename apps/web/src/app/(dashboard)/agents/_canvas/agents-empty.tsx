import type * as React from "react";

import { Icon } from "@/components/v2/primitives";

/**
 * Figma 07 `agents-customer/empty` (411:31938): centered in the canvas beside the Sources panel.
 * `action` is the Create customer agent dialog trigger (owners only).
 */
export function AgentsEmpty({ companyName, action }: { companyName: string; action?: React.ReactNode }) {
  return (
    <div
      data-slot="agents-empty"
      className="flex min-h-[320px] w-[520px] max-w-full flex-col items-center justify-center gap-3 px-6 text-center lg:min-h-[700px]"
    >
      <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Icon name="messages-square" size={20} />
      </span>
      <h2 className="type-h3 text-foreground">No customer agents yet</h2>
      <p className="max-w-[360px] type-small text-muted-foreground">
        Create a customer agent for {companyName}, then connect the website widget or a messaging source and
        bind it to the agent.
      </p>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
