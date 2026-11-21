import { beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut } from "@/lib/auth";
import {
  signInWithDev,
  signInWithNexAuth,
  signOutAction,
} from "./auth-actions";

describe("auth-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signInWithDev passes form credentials to the dev provider", async () => {
    const formData = new FormData();
    formData.set("username", "operator");
    formData.set("password", "secret");

    await signInWithDev(formData);

    expect(signIn).toHaveBeenCalledWith("dev-login", {
      username: "operator",
      password: "secret",
      redirectTo: "/home",
    });
  });

  it("signInWithNexAuth starts the OIDC sign-in", async () => {
    await signInWithNexAuth();

    expect(signIn).toHaveBeenCalledWith("nexauth", { redirectTo: "/home" });
  });

  it("signOutAction signs out toward sign-in", async () => {
    await signOutAction();

    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });
});
