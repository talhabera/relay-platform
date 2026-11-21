"use client";

import { useRouter } from "next/navigation";

import { Segmented } from "@/components/v2/primitives";

const ITEMS = [
  { value: "all", label: "All" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/** All · Daily · Weekly · Monthly Segmented, wired to `?period=`. */
export function ArchiveFilterControl({ value, hrefs }: { value: string; hrefs: Record<string, string> }) {
  const router = useRouter();
  return (
    <Segmented
      aria-label="Report period"
      items={ITEMS}
      value={value}
      onValueChange={(next) => router.push(hrefs[next] ?? hrefs.all)}
    />
  );
}
