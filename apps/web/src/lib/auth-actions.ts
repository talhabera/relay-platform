"use server";

import { signIn, signOut } from "@/lib/auth";

export async function signInWithDev(formData: FormData) {
  await signIn("dev-login", {
    username: String(formData.get("username") ?? ""),
    password: String(formData.get("password") ?? ""),
    redirectTo: "/home",
  });
}

export async function signInWithNexAuth() {
  await signIn("nexauth", { redirectTo: "/home" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}
