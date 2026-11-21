"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectorRow } from "@/components/v2/data";
import { AgentChip, IconButton } from "@/components/v2/primitives";

import { connectOperatorConnector, disconnectOperatorConnector } from "../companies/connector-actions";
import { CONNECTOR_INFO, hasStoredKey, oauthStartUrl, type ConnectorListItem } from "./connector-view";

type Dialogs = { kind: "key" | "remove"; item: ConnectorListItem } | null;

/** Figma 08c `connectors`: one Connector row per operator connector, key dialog, remove dialog. */
export function ConnectorsList({
  companyId,
  connectors,
}: {
  companyId: string;
  connectors: ConnectorListItem[];
}) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const close = () => setDialog(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const connectorError = searchParams.get("connectorError");

  // Back from Google sign-in (S73): say how it went once, then drop the query.
  useEffect(() => {
    if (!connected && !connectorError) return;
    if (connectorError) toast.error(connectorError);
    else if (connected === "google_workspace") toast.success("Google Workspace connected");
    router.replace("/settings/connectors");
  }, [connected, connectorError, router]);

  const signIn = (item: ConnectorListItem) => {
    if (item.type === "google_workspace") {
      window.location.assign(oauthStartUrl(item.type, companyId));
    }
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="min-w-[720px] [&>[data-slot=connector-row]:last-child]:border-b-0">
          {connectors.map((item) => {
            const info = CONNECTOR_INFO[item.type];
            return (
              <ConnectorRow
                key={item.type}
                status={item.status}
                brand={info.brand}
                name={info.name}
                description={info.description}
                meta={item.meta}
                onAction={() => (info.auth === "oauth" ? signIn(item) : setDialog({ kind: "key", item }))}
                menu
                menuSlot={
                  hasStoredKey(item) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton icon="ellipsis" label={`More for ${info.name}`} size="sm" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {info.auth === "oauth" ? (
                          <DropdownMenuItem onSelect={() => signIn(item)}>Reconnect</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "key", item })}>
                            Replace key
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "remove", item })}>
                          Remove connector
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="size-8 shrink-0" aria-hidden />
                  )
                }
              />
            );
          })}
        </div>
      </div>

      <EditKeyDialog
        key={dialog?.kind === "key" ? dialog.item.type : "key-none"}
        companyId={companyId}
        item={dialog?.kind === "key" ? dialog.item : null}
        onClose={close}
      />
      <RemoveConnectorDialog
        companyId={companyId}
        item={dialog?.kind === "remove" ? dialog.item : null}
        onClose={close}
      />
    </>
  );
}

/** Figma `connectors-edit-key`: replace (or first connect) the key; the old key stays until save. */
function EditKeyDialog({
  companyId,
  item,
  onClose,
}: {
  companyId: string;
  item: ConnectorListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const info = item ? CONNECTOR_INFO[item.type] : null;
  const replacing = item ? hasStoredKey(item) : false;
  const complete = info?.fields.every((f) => values[f.name]?.trim()) ?? false;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!item || !info || !complete || item.type === "google_workspace") return;
    setPending(true);
    try {
      const result = await connectOperatorConnector({
        companyId,
        type: item.type,
        ...values,
      });
      if ("error" in result) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(`${info.name} key saved`);
      onClose();
      router.refresh();
    } catch {
      toast.error(`Couldn't save the ${info.name} key`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent showCloseButton={false}>
        {info ? (
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{replacing ? `Replace ${info.name} key` : `Connect ${info.name}`}</DialogTitle>
              <DialogDescription>
                {replacing
                  ? `The current key${item?.keyHint ? ` (${item.keyHint})` : ""} stays active until you save the new one.`
                  : `Paste the key from your ${info.name} account. It is checked before it is saved.`}
              </DialogDescription>
            </DialogHeader>
            {info.fields.map((field, index) => (
              <div key={field.name} className="flex flex-col gap-2">
                <Label htmlFor={`connector-${field.name}`}>
                  {replacing && info.fields.length === 1 ? `New ${field.label}` : field.label}
                </Label>
                <Input
                  id={`connector-${field.name}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={index === 0}
                  value={values[field.name] ?? ""}
                  onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
                />
              </div>
            ))}
            <p className="type-caption text-muted-foreground">
              The key is masked while you type. After saving, only its last four characters are shown.
            </p>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={!complete || pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {replacing ? "Save key" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Figma `connectors-remove`: who uses it, what breaks, and that the stored key is deleted. */
function RemoveConnectorDialog({
  companyId,
  item,
  onClose,
}: {
  companyId: string;
  item: ConnectorListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const info = item ? CONNECTOR_INFO[item.type] : null;

  async function remove() {
    if (!item || !info) return;
    setPending(true);
    try {
      await disconnectOperatorConnector({ companyId, type: item.type });
      toast.success(`${info.name} removed`);
      onClose();
      router.refresh();
    } catch {
      toast.error(`Couldn't remove ${info.name}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent showCloseButton={false}>
        {info && item ? (
          <>
            <DialogHeader>
              <DialogTitle icon>Remove {info.name}?</DialogTitle>
            </DialogHeader>
            {item.usedBy.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="type-label uppercase text-muted-foreground">Used by</span>
                <ul className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  {item.usedBy.map((agent) => (
                    <li key={agent.id} className="flex flex-wrap items-center gap-2">
                      <AgentChip
                        kind="operator"
                        name={agent.name}
                        version={agent.version}
                        status={agent.version ? "live" : "none"}
                      />
                      {agent.packageName ? (
                        <span className="flex items-center gap-1 type-small text-muted-foreground">
                          <Package className="size-4" aria-hidden />
                          in the {agent.packageName} package
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="flex items-start gap-2 type-small text-foreground">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  {info.auth === "oauth"
                    ? "Approved outreach goes back to copy and send yourself until you connect it again."
                    : `Lead research with ${info.name} will fail until you connect ${info.name} again.`}
                </p>
              </div>
            ) : null}
            <DialogDescription>
              {info.auth === "oauth"
                ? `Relay's access to your Gmail is revoked. To send from Gmail later, connect ${info.name} again.`
                : `The stored API key is deleted. To use ${info.name} later, add a new key.`}
            </DialogDescription>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={remove} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Remove connector
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
