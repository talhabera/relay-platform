import { ExternalLink, Info } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies } from "@/lib/operator/companies";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SettingsHeader } from "../settings-header";

/** Profile (Figma 08c `08/settings/profile`): read-only identity, managed by NexAuth. */
export default async function ProfileSettingsPage() {
  const session = await requireSession();
  const companies = await listAccessibleCompanies(session.user.id);
  const owned = companies
    .filter((company) => company.ownerId === session.user.id)
    .map((company) => company.name);
  const initials = session.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const nexAuthUrl = process.env.NEXAUTH_ISSUER ?? null;

  return (
    <div>
      <SettingsHeader
        title="Profile"
        description="How you appear to members and in agent transcripts."
      />
      <div className="flex max-w-md flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarImage src={session.user.image ?? undefined} alt={session.user.name} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{session.user.name}</p>
            {owned.length > 0 ? (
              <p className="truncate text-xs text-muted-foreground">
                Owner of {owned.join(", ")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-name">Full name</Label>
          <Input id="profile-name" value={session.user.name} readOnly disabled />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" value={session.user.email} readOnly disabled />
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            Managed by NexAuth. Change your name or email in your NexAuth account.
          </p>
          {nexAuthUrl ? (
            <Button variant="outline" size="sm" asChild>
              <a href={nexAuthUrl} target="_blank" rel="noreferrer">
                Open NexAuth
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
