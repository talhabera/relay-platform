"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  getBrowserSubscription,
  isPushSupported,
  subscribeBrowser,
} from "@/lib/push/browser";
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  isBrowserNotificationsOn,
} from "./actions";

type State = "loading" | "unconfigured" | "unsupported" | "denied" | "off" | "on";

const DESCRIPTION: Record<State, string> = {
  loading: "Get a notification in this browser for each new item in Needs you.",
  unconfigured: "Browser notifications are not set up on this server yet.",
  unsupported:
    "This browser cannot show notifications. On iPhone and iPad, add Relay to the Home Screen first.",
  denied: "Notifications are blocked for Relay in this browser's site settings.",
  off: "Get a notification in this browser for each new item in Needs you.",
  on: "On for this browser. Each new item you can act on raises one notification.",
};

/** Off by default, per browser (approve-rights spec decision 9). */
export function BrowserNotificationsToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const id = useId();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function read(): Promise<State> {
      if (!vapidPublicKey) return "unconfigured";
      if (!isPushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const subscription = await getBrowserSubscription();
      if (!subscription) return "off";
      // On only when the server holds it for this user: a browser another
      // user turned on, or one the push service dropped, reads as off.
      return (await isBrowserNotificationsOn({ endpoint: subscription.endpoint })) ? "on" : "off";
    }
    read()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("off");
      });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function turnOn() {
    if (!vapidPublicKey) return;
    const outcome = await subscribeBrowser(vapidPublicKey);
    if (!outcome.ok) {
      setState(outcome.reason);
      return;
    }
    const saved = await enableBrowserNotifications(outcome.subscription.toJSON());
    if ("error" in saved) {
      await outcome.subscription.unsubscribe();
      toast.error(saved.error);
      return;
    }
    setState("on");
  }

  async function turnOff() {
    const subscription = await getBrowserSubscription();
    if (subscription) {
      await disableBrowserNotifications({ endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setState("off");
  }

  async function onCheckedChange(checked: boolean) {
    setBusy(true);
    try {
      await (checked ? turnOn() : turnOff());
    } catch {
      toast.error("Could not change browser notifications");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = state === "unconfigured" || state === "unsupported" || state === "denied";
  return (
    <Field>
      <div className="flex items-center justify-between gap-4">
        <FieldTitle id={`${id}-label`}>Browser notifications</FieldTitle>
        <Switch
          aria-labelledby={`${id}-label`}
          checked={state === "on"}
          disabled={busy || state === "loading" || unavailable}
          onCheckedChange={(checked) => void onCheckedChange(checked)}
        />
      </div>
      <FieldDescription>{DESCRIPTION[state]}</FieldDescription>
    </Field>
  );
}
