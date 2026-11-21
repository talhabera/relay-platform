import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { isClientUser, upsertUserFromProfile } from "./users";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (trigger === "signIn" && user) {
        const relayUserId = await upsertUserFromProfile({
          id: user.id ?? token.sub ?? "",
          email: user.email ?? "",
          name: user.name,
          image: user.image,
        });
        token.sub = relayUserId;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image ?? undefined;
        token.isClient = await isClientUser(relayUserId);
      } else if (token.isClient === undefined && token.sub) {
        // Tokens issued before the claim existed: resolve once, then carry it.
        token.isClient = await isClientUser(token.sub);
      }
      return token;
    },
  },
});
