"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  MessageSquare,
  Instagram,
  Send,
  MessageCircle,
  Globe,
  Plus,
  Loader2,
  Trash2,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/v2/primitives";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { FieldPath } from "react-hook-form";
import {
  createChannelSchema,
  type CreateChannelInput,
} from "@/lib/validators/channel";
import {
  createChannel,
  updateChannel,
  setChannelFlag,
  deleteChannel,
} from "@/app/(dashboard)/agents/actions";
import type { ChannelFlag } from "@relay/agent-ops";
import { CHANNEL_TYPE_LABELS } from "@/constants";
import type { ChannelType } from "@/types";
import type { ChannelView } from "@/lib/client-views";

const channelIcons: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  instagram: Instagram,
  telegram: Send,
  messenger: MessageCircle,
  widget: Globe,
};

const channelColors: Record<string, string> = {
  whatsapp: "bg-brand-whatsapp/15 text-foreground",
  instagram: "bg-brand-instagram/15 text-foreground",
  telegram: "bg-brand-telegram/15 text-foreground",
  messenger: "bg-brand-messenger/15 text-foreground",
  widget: "bg-primary-soft text-primary-soft-foreground",
};

// Config field definitions per channel type
const channelConfigFields: Record<
  string,
  { key: string; label: string; placeholder: string }[]
> = {
  whatsapp: [
    { key: "apiKey", label: "API Key", placeholder: "Your WhatsApp API key" },
    {
      key: "phoneNumberId",
      label: "Phone Number ID",
      placeholder: "Phone number ID",
    },
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "Access token",
    },
  ],
  instagram: [
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "Instagram access token",
    },
    {
      key: "accountId",
      label: "Account ID",
      placeholder: "Instagram account ID",
    },
  ],
  telegram: [
    { key: "botToken", label: "Bot Token", placeholder: "Telegram bot token" },
  ],
  messenger: [
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "Messenger access token",
    },
    { key: "apiKey", label: "App Secret", placeholder: "App secret key" },
  ],
  widget: [
    { key: "widgetId", label: "Widget ID", placeholder: "Widget identifier" },
  ],
};

type ChannelsTabProps = {
  agentId: string;
  channels: ChannelView[];
};

export function ChannelsTab({ agentId, channels: initialChannels }: ChannelsTabProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Channels</h3>
          <p className="text-sm text-muted-foreground">
            Connect messaging platforms so your agent can respond to
            conversations.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Channel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Channel</DialogTitle>
              <DialogDescription>
                Connect a new messaging channel to this agent.
              </DialogDescription>
            </DialogHeader>
            <CreateChannelForm
              agentId={agentId}
              onSuccess={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialChannels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No channels connected"
          description="Add a messaging channel so your agent can start receiving and responding to conversations."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {initialChannels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({ channel }: { channel: ChannelView }) {
  const router = useRouter();
  const Icon = channelIcons[channel.type] ?? MessageSquare;
  const colorClass = channelColors[channel.type] ?? "";
  // Only the platforms with an inbound webhook can auto-reply.
  const supportsAutoReply =
    channel.type === "whatsapp" || channel.type === "instagram";
  // Comments exist on Instagram only.
  const supportsCommentReply = channel.type === "instagram";

  async function handleToggleStatus() {
    try {
      const newStatus = channel.status === "active" ? "inactive" : "active";
      await updateChannel(channel.id, { status: newStatus });
      toast.success(
        `Channel ${newStatus === "active" ? "activated" : "deactivated"}`
      );
      router.refresh();
    } catch {
      toast.error("Failed to update channel status");
    }
  }

  async function handleToggleFlag(flag: ChannelFlag, enabled: boolean) {
    try {
      // A dedicated action: `updateChannel` replaces `config` wholesale and
      // would wipe this channel's credentials.
      await setChannelFlag(channel.id, flag, enabled);
      toast.success(enabled ? "Turned on" : "Turned off");
      router.refresh();
    } catch {
      toast.error("Failed to update the channel");
    }
  }

  async function handleDelete() {
    try {
      await deleteChannel(channel.id);
      toast.success("Channel deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete channel");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-md p-2 ${colorClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">{channel.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {CHANNEL_TYPE_LABELS[channel.type] ?? channel.type}
              </p>
            </div>
          </div>
          <StatusChip tone={channel.status === "active" ? "live" : "neutral"}>
            {channel.status === "active" ? "Active" : "Inactive"}
          </StatusChip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {supportsAutoReply && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Auto-reply</span>
            <Switch
              checked={channel.config?.autoReply === true}
              onCheckedChange={(enabled) =>
                handleToggleFlag("autoReply", enabled)
              }
            />
          </div>
        )}
        {supportsCommentReply && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Reply to comments publicly
            </span>
            <Switch
              checked={channel.config?.autoCommentReply === true}
              onCheckedChange={(enabled) =>
                handleToggleFlag("autoCommentReply", enabled)
              }
            />
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status</span>
            <Switch
              checked={channel.status === "active"}
              onCheckedChange={handleToggleStatus}
            />
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            }
            title="Delete Channel"
            description={`Are you sure you want to delete "${channel.name}"? This action cannot be undone.`}
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={handleDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CreateChannelForm({
  agentId,
  onSuccess,
}: {
  agentId: string;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<ChannelType | "">("");

  const form = useForm<CreateChannelInput>({
    resolver: zodResolver(createChannelSchema),
    defaultValues: {
      name: "",
      type: undefined as unknown as ChannelType,
      agentId,
      config: {},
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(data: CreateChannelInput) {
    try {
      await createChannel(data);
      toast.success("Channel created successfully");
      form.reset();
      router.refresh();
      onSuccess();
    } catch {
      toast.error("Failed to create channel");
    }
  }

  const configFields =
    selectedType ? channelConfigFields[selectedType] ?? [] : [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Channel Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Main WhatsApp" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Channel Type</FormLabel>
              <Select
                onValueChange={(val) => {
                  field.onChange(val);
                  setSelectedType(val as ChannelType);
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a channel type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(CHANNEL_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {configFields.map((configField) => (
          <FormField
            key={configField.key}
            control={form.control}
            name={`config.${configField.key}` as FieldPath<CreateChannelInput>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{configField.label}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={configField.placeholder}
                    {...field}
                    value={(field.value as string) ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}

        {(selectedType === "whatsapp" || selectedType === "instagram") && (
          <FormField
            control={form.control}
            name={"config.autoReply" as FieldPath<CreateChannelInput>}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5 pr-4">
                  <FormLabel>Auto-reply</FormLabel>
                  <p className="text-muted-foreground text-sm">
                    Let this agent answer incoming messages automatically. Off
                    means messages are stored for you to read.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value === true}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}

        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Channel
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
