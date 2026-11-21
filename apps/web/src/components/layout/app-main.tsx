"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

function isBleedPath(pathname: string) {
  return pathname === "/messaging";
}

export function AppMain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const bleed = isBleedPath(pathname);

  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        bleed
          ? "overflow-hidden p-0"
          : "gap-4 overflow-y-auto px-4 pb-6 md:px-6",
        className,
      )}
    >
      {children}
    </main>
  );
}
