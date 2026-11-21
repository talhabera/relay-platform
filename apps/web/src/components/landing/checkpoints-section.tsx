import { Icon } from "@/components/v2/primitives";
import { CheckpointCard } from "@/components/v2/session";

import { LandingSection } from "./section";

const BULLETS = [
  "Every checkpoint shows exactly what will be sent",
  "Steer a running session: tell the agent what to change",
  "Members without approval rights get a read-only view",
  "Everything waiting on you, in one Needs you list",
] as const;

/** Figma 09 `section/checkpoints` (`415:58423`): copy + bullets beside a pending Checkpoint card. */
export function CheckpointsSection() {
  return (
    <LandingSection data-slot="landing-checkpoints">
      <div className="grid w-full items-center gap-16 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col items-start gap-4">
          <p className="type-label text-primary">Checkpoints</p>
          <h2 className="type-h2 text-foreground">Nothing leaves without your approval.</h2>
          <p className="type-body text-muted-foreground">
            Agents stop at a checkpoint before anything reaches a client’s customers. Approve it, ask for changes in
            plain words, or discard it.
          </p>
          <ul className="flex flex-col gap-3 pt-2">
            {BULLETS.map((bullet) => (
              <li key={bullet} className="flex items-center gap-3 type-small text-foreground">
                <Icon name="check" size={16} className="shrink-0 text-primary" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
        <div
          data-slot="checkpoint-panel"
          aria-hidden
          inert
          className="flex min-w-0 flex-col items-center rounded-2xl border border-border bg-canvas p-4 md:px-10 md:py-12"
        >
          <CheckpointCard
            state="pending"
            className="max-w-[480px]"
            title="Schedule sequence to 44 leads"
            meta="Starts Tue 29 Sep, 09:00 · max 40 emails a day · sender Markus Albrecht, Acme GmbH"
            approveLabel="Approve & schedule"
          />
        </div>
      </div>
    </LandingSection>
  );
}
