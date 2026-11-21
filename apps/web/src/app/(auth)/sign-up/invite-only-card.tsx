import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/v2/shell/system-states";

/** Figma `03/sign-up/invite-only` (`376:24339`). */
export function InviteOnlyCard() {
  return (
    <AuthCard
      title="Invite only"
      description="Relay accounts are created by invitation. Ask a company owner to add you by email, then sign in."
    >
      <Button asChild size="lg" className="w-full">
        <Link href="/sign-in">Go to sign in</Link>
      </Button>
      <p className="type-caption text-center text-muted-foreground">
        Already invited? Sign in with the email the owner added.
      </p>
    </AuthCard>
  );
}
