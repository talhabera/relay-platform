import { Inbox, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** Lucide icon in the 48px tile; defaults to Inbox as in Figma. */
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
};

/** Figma Empty state (10:94): variant = with-action | without-action. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-variant={action ? "with-action" : "without-action"}
      className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}
    >
      <div
        data-slot="empty-state-icon"
        className="bg-secondary text-foreground flex size-12 shrink-0 items-center justify-center rounded-xl"
      >
        <Icon className="size-6" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 data-slot="empty-state-title" className="type-h3 text-foreground">
        {title}
      </h3>
      <p data-slot="empty-state-description" className="type-body text-muted-foreground max-w-md">
        {description}
      </p>
      {action &&
        (action.href ? (
          <Button asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        ))}
    </div>
  );
}
