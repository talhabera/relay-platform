import { cn } from "@/lib/utils";
import { Chip } from "@/components/v2/primitives";
import { CHANNEL_TYPE_LABELS } from "@/constants";
import type { ChannelType } from "@/types";

const channelColors: Record<ChannelType, string> = {
  whatsapp: "bg-brand-whatsapp/15 text-foreground",
  instagram: "bg-brand-instagram/15 text-foreground",
  telegram: "bg-brand-telegram/15 text-foreground",
  messenger: "bg-brand-messenger/15 text-foreground",
  widget: "bg-primary-soft text-primary-soft-foreground",
};

type ChannelBadgeProps = {
  channel: ChannelType;
  className?: string;
};

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  return (
    <Chip
      asStatic
      className={cn(
        "border-transparent",
        channelColors[channel],
        className
      )}
    >
      {CHANNEL_TYPE_LABELS[channel] ?? channel}
    </Chip>
  );
}
