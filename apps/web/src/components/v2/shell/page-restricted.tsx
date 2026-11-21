import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";

type PageRestrictedProps = {
  className?: string;
  icon?: IconName;
  title?: string;
  description?: string;
  actionLabel?: string;
  /** `null` hides the action. */
  actionHref?: string | null;
};

/**
 * Figma `Page restricted` (02 `10:80`): 480px card, 48px lock tile, h3 title, body copy,
 * outline "Back to Home" button. Shown on gated routes; members are not redirected.
 */
function PageRestricted({
  className,
  icon = "lock",
  title = "You do not have access to this page",
  description = "Ask a company owner to grant you access, then reload.",
  actionLabel = "Back to Home",
  actionHref = "/home",
}: PageRestrictedProps) {
  return (
    <section
      data-slot="page-restricted"
      className={cn(
        "flex w-full max-w-120 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center shadow-elevation-1",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary">
        <Icon name={icon} size={24} className="text-muted-foreground" />
      </span>
      <h2 className="type-h3 text-foreground">{title}</h2>
      <p className="type-body text-muted-foreground">{description}</p>
      {actionHref ? (
        <Button asChild variant="outline">
          <Link href={actionHref}>
            <Icon name="arrow-left" size={16} />
            {actionLabel}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

export { PageRestricted };
export type { PageRestrictedProps };
