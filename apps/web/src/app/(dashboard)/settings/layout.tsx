import { SettingsNavPanel } from "./settings-nav-panel";

/** Settings shell (Figma 08c `500:68865`): one card, nav column on the left, page on the right. */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs md:flex-row">
      <aside className="shrink-0 border-b p-4 md:w-56 md:border-r md:border-b-0 md:p-4">
        <h1 className="mb-4 px-2 text-xl font-semibold tracking-tight">Settings</h1>
        <SettingsNavPanel />
      </aside>
      <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
    </div>
  );
}
