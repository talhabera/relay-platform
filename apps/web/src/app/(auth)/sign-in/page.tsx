import { signInWithDev, signInWithNexAuth } from "@/lib/auth-actions";
import {
  expectedDevUsername,
  isLocalDevAuthEnabled,
  isOidcConfigured,
} from "@/lib/dev-auth";

import { SignInCard } from "./sign-in-card";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <SignInCard
      error={Boolean(error)}
      oidc={isOidcConfigured()}
      localDev={isLocalDevAuthEnabled()}
      devUser={expectedDevUsername()}
      onNexAuth={signInWithNexAuth}
      onDev={signInWithDev}
    />
  );
}
