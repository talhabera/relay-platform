import type { Metadata } from "next";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/v2/primitives/icon";
import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";
import { initials } from "@/components/v2/shell/initials";

import { ClientPortalHeader } from "../portal-header";

import { saveWhatsappNumber } from "./actions";
import { loadClientProfile, ROLE_LABELS } from "./load-profile";
import { WhatsappForm } from "./profile-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profile" };

/**
 * Client user Profile (S107, Figma 11 `11/profile/default` `695:89346`): name and email are
 * read-only (NexAuth); the WhatsApp number is the one field the client edits. It feeds the
 * handoff primary-recipient picker and the portal bell.
 */
export default async function ClientProfilePage() {
  const data = await loadClientProfile();

  if (data.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </SystemStateFrame>
    );
  }

  const { company, user, role } = data;
  const nexAuthUrl = process.env.NEXAUTH_ISSUER ?? null;

  return (
    <div className="min-h-svh bg-background">
      <ClientPortalHeader active={null} company={company} />
      <main className="flex w-full flex-col gap-5 px-4 pt-2 pb-12 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="type-h3 text-foreground">Profile</h1>
          <p className="type-small text-muted-foreground">
            How you appear to {company.name}&apos;s agency and in handoff answers.
          </p>
        </header>
        <div className="flex max-w-md flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar size="md">
              {user.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate type-body-strong text-foreground">{user.name}</p>
              <p className="truncate type-caption text-muted-foreground">
                {ROLE_LABELS[role]} · {company.name}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input id="profile-name" value={user.name} readOnly disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user.email} readOnly disabled />
          </div>
          <WhatsappForm initial={user.whatsappNumber} save={saveWhatsappNumber} />
          <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 type-caption text-muted-foreground">
            <Icon name="info" size={16} className="shrink-0" />
            <p className="min-w-0 flex-1">Managed by NexAuth. Change your name or email in your NexAuth account.</p>
            {nexAuthUrl ? (
              <Button variant="ghost" size="sm" asChild>
                <a href={nexAuthUrl} target="_blank" rel="noreferrer">
                  Open NexAuth
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
