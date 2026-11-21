"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Hash,
  Headphones,
  ShoppingBag,
  Plug,
  Plus,
  Loader2,
  Trash2,
  AlertCircle,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StatusChip, type StatusTone } from "@/components/v2/primitives";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { FieldPath } from "react-hook-form";
import {
  createIntegrationSchema,
  type CreateIntegrationInput,
} from "@/lib/validators/integration";
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
} from "@/app/(dashboard)/agents/actions";
import {
  INTEGRATION_STATUS_LABELS,
  INTEGRATION_TYPE_LABELS,
} from "@/constants";
import type { IntegrationType, IntegrationStatus } from "@/types";
import type { IntegrationView } from "@/lib/client-views";

// Use consistent icon types from lucide-react
const INTEGRATION_STATUS_TONES: Record<IntegrationStatus, StatusTone> = {
  connected: "live",
  disconnected: "neutral",
  pending: "pending",
  error: "error",
};

const integrationIcons: Record<string, typeof Hash> = {
  slack: Hash,
  discord: Hash,
  zendesk: Headphones,
  shopify: ShoppingBag,
  mcp_custom: Plug,
};

const integrationColors: Record<string, string> = {
  slack: "bg-brand-slack/15 text-foreground",
  discord: "bg-muted text-foreground",
  zendesk: "bg-brand-zendesk/15 text-foreground",
  shopify: "bg-brand-shopify/15 text-foreground",
  mcp_custom: "bg-muted text-muted-foreground",
};

// Config field definitions per integration type
const integrationConfigFields: Record<
  string,
  { key: string; label: string; placeholder: string }[]
> = {
  slack: [
    {
      key: "webhookUrl",
      label: "Webhook URL",
      placeholder: "https://hooks.slack.com/...",
    },
    { key: "channelId", label: "Channel ID", placeholder: "C0123456789" },
    {
      key: "accessToken",
      label: "Bot Token",
      placeholder: "xoxb-...",
    },
  ],
  discord: [
    {
      key: "webhookUrl",
      label: "Webhook URL",
      placeholder: "https://discord.com/api/webhooks/...",
    },
    {
      key: "accessToken",
      label: "Bot Token",
      placeholder: "Discord bot token",
    },
  ],
  zendesk: [
    {
      key: "customDomain",
      label: "Subdomain",
      placeholder: "yourcompany.zendesk.com",
    },
    { key: "apiKey", label: "API Key", placeholder: "Zendesk API key" },
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "Zendesk access token",
    },
  ],
  shopify: [
    {
      key: "customDomain",
      label: "Store Domain",
      placeholder: "yourstore.myshopify.com",
    },
    { key: "apiKey", label: "API Key", placeholder: "Shopify API key" },
    {
      key: "apiSecret",
      label: "API Secret",
      placeholder: "Shopify API secret",
    },
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "Shopify access token",
    },
  ],
  mcp_custom: [
    {
      key: "mcpEndpoint",
      label: "MCP Endpoint",
      placeholder: "https://your-mcp-server.com/mcp",
    },
    { key: "apiKey", label: "API Key (optional)", placeholder: "API key" },
  ],
};

type IntegrationsTabProps = {
  companyId: string;
  agentId: string;
  integrations: IntegrationView[];
};

export function IntegrationsTab({
  companyId,
  agentId,
  integrations: initialIntegrations,
}: IntegrationsTabProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Integrations</h3>
          <p className="text-sm text-muted-foreground">
            Connect third-party services to extend your agent&apos;s
            capabilities.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Integration
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Integration</DialogTitle>
              <DialogDescription>
                Connect a new service to this agent.
              </DialogDescription>
            </DialogHeader>
            <CreateIntegrationForm
              companyId={companyId}
              agentId={agentId}
              onSuccess={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialIntegrations.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No integrations connected"
          description="Connect third-party services like Slack, Discord, Shopify, or custom MCP servers to give your agent more capabilities."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {initialIntegrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationView }) {
  const router = useRouter();
  const Icon = integrationIcons[integration.type] ?? Plug;
  const colorClass = integrationColors[integration.type] ?? "";

  async function handleToggleConnection() {
    try {
      const newStatus: IntegrationStatus =
        integration.status === "connected" ? "disconnected" : "connected";
      await updateIntegration(integration.id, { status: newStatus });
      toast.success(
        `Integration ${newStatus === "connected" ? "connected" : "disconnected"}`
      );
      router.refresh();
    } catch {
      toast.error("Failed to update integration status");
    }
  }

  async function handleDelete() {
    try {
      await deleteIntegration(integration.id);
      toast.success("Integration deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete integration");
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
              <CardTitle className="text-sm">{integration.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {INTEGRATION_TYPE_LABELS[integration.type] ?? integration.type}
              </p>
            </div>
          </div>
          <StatusChip
            tone={INTEGRATION_STATUS_TONES[integration.status as IntegrationStatus]}
          >
            {INTEGRATION_STATUS_LABELS[integration.status as IntegrationStatus] ??
              integration.status}
          </StatusChip>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {integration.error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{integration.error}</span>
          </div>
        )}
        {integration.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            Last sync: {integration.lastSyncAt.toLocaleString()}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleConnection}
          >
            {integration.status === "connected" ? "Disconnect" : "Connect"}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            }
            title="Delete Integration"
            description={`Are you sure you want to delete "${integration.name}"? This action cannot be undone.`}
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={handleDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function CreateIntegrationForm({
  companyId,
  agentId,
  onSuccess,
}: {
  companyId: string;
  agentId: string;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<IntegrationType | "">("");

  const form = useForm<CreateIntegrationInput>({
    resolver: zodResolver(createIntegrationSchema),
    defaultValues: {
      name: "",
      type: undefined as unknown as IntegrationType,
      companyId,
      agentId,
      config: {},
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(data: CreateIntegrationInput) {
    try {
      await createIntegration(data);
      toast.success("Integration created successfully");
      form.reset();
      router.refresh();
      onSuccess();
    } catch {
      toast.error("Failed to create integration");
    }
  }

  const configFields =
    selectedType ? integrationConfigFields[selectedType] ?? [] : [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Integration Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Shopify Store" {...field} />
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
              <FormLabel>Integration Type</FormLabel>
              <Select
                onValueChange={(val) => {
                  field.onChange(val);
                  setSelectedType(val as IntegrationType);
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an integration type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(INTEGRATION_TYPE_LABELS).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    )
                  )}
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
            name={`config.${configField.key}` as FieldPath<CreateIntegrationInput>}
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

        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Integration
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
