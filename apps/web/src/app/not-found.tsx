import { AuthStage, PublicNotFound } from "@/components/v2/shell/system-states";

/** Unmatched URLs (Figma `03/not-found/public`). In-app 404s use `(dashboard)/not-found.tsx`. */
export default function NotFound() {
  return (
    <AuthStage>
      <PublicNotFound />
    </AuthStage>
  );
}
