import { InAppNotFound, SystemStateFrame } from "@/components/v2/shell/system-states";

/** `notFound()` inside the app shell (Figma `03/not-found/in-app`). */
export default function DashboardNotFound() {
  return (
    <SystemStateFrame>
      <InAppNotFound />
    </SystemStateFrame>
  );
}
