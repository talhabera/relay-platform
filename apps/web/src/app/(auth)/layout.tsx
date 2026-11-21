import { AuthStage } from "@/components/v2/shell/system-states";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthStage>{children}</AuthStage>;
}
