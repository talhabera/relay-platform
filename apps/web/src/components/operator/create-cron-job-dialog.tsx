"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  createCronJobSchema,
  type CreateCronJobInput,
} from "@/lib/validators/cron";
import {
  CRON_PRESETS,
  type CronPresetValue,
  presetToScheduleFields,
} from "@/lib/operator/cron-presets";
import { createCronJob } from "@/app/(dashboard)/operator/cron-actions";

type EditableAgent = {
  id: string;
  name: string;
  versions: { id: string; name: string }[];
};

type CreateCronJobFormValues = {
  agentId: string;
  versionId: string;
  name: string;
  prompt: string;
  preset: CronPresetValue;
  timezone: string;
  timeOfDay: string;
  weekday: string;
};

function buildDefaults(agents: EditableAgent[]): CreateCronJobFormValues {
  const firstAgent = agents[0];
  return {
    agentId: firstAgent?.id ?? "",
    versionId: firstAgent?.versions[0]?.id ?? "",
    name: "",
    prompt: "",
    preset: "interval:30",
    timezone: "UTC",
    timeOfDay: "09:00",
    weekday: "1",
  };
}

export function CreateCronJobDialog({
  agents,
  triggerVariant = "default",
  triggerSize,
}: {
  agents: EditableAgent[];
  /** Operator inspector Schedules tab uses a small outline trigger (Figma 07 schedules). */
  triggerVariant?: "default" | "outline";
  triggerSize?: "sm";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const form = useForm<CreateCronJobFormValues>({
    defaultValues: buildDefaults(agents),
  });

  const selectedAgentId = form.watch("agentId");
  const selectedPreset = form.watch("preset");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (!selectedAgent) return;
    const currentVersionId = form.getValues("versionId");
    if (!selectedAgent.versions.some((v) => v.id === currentVersionId)) {
      form.setValue("versionId", selectedAgent.versions[0]?.id ?? "");
    }
  }, [selectedAgent, form]);

  const isSubmitting = form.formState.isSubmitting;
  const showTimeFields =
    selectedPreset === "daily" || selectedPreset === "weekly";

  async function onSubmit(values: CreateCronJobFormValues) {
    const schedule = presetToScheduleFields(values.preset, {
      timeOfDay:
        values.timeOfDay.includes(":")
          ? Number(values.timeOfDay.split(":")[0]) * 60 +
            Number(values.timeOfDay.split(":")[1])
          : 540,
      weekday: Number(values.weekday),
      timezone: values.timezone,
    });

    const payload: CreateCronJobInput = {
      agentId: values.agentId,
      versionId: values.versionId,
      name: values.name,
      prompt: values.prompt,
      enabled: true,
      ...schedule,
    };

    try {
      createCronJobSchema.parse(payload);
      const result = await createCronJob(payload);
      toast.success("Schedule created");
      setOpen(false);
      form.reset(buildDefaults(agents));
      router.push(`/operator?tab=cron&jobId=${result.id}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create cron job",
      );
    }
  }

  if (agents.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Plus className="size-4" />
          New schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New schedule</DialogTitle>
          <DialogDescription>
            Each run opens a session with the operator agent you pick.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="agentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select agent" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="versionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Version</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!selectedAgent}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectedAgent?.versions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Daily report" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prompt</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What should the agent do each run?"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Schedule</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select schedule" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CRON_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <FormControl>
                    <Input placeholder="UTC" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showTimeFields && (
              <FormField
                control={form.control}
                name="timeOfDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedPreset === "weekly" && (
              <FormField
                control={form.control}
                name="weekday"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weekday</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select weekday" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
