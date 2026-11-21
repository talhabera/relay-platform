import { MarketingShell } from "@/components/landing/marketing-shell";
import { Toaster } from "@/components/ui/sonner";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <MarketingShell>{children}</MarketingShell>
      <Toaster />
    </>
  );
}
