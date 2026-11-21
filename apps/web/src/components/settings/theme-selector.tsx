"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Field,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const subscribe = () => () => {};

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <Field>
      <FieldTitle id="theme-label">Theme</FieldTitle>
      {mounted ? (
        <ToggleGroup
          type="single"
          variant="outline"
          value={theme ?? "system"}
          onValueChange={(value) => {
            if (value) setTheme(value);
          }}
          aria-labelledby="theme-label"
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value}>
              <Icon />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <Skeleton className="h-9 w-72" />
      )}
      <FieldDescription>
        System follows this device. Dark is the designed default.
      </FieldDescription>
    </Field>
  );
}
