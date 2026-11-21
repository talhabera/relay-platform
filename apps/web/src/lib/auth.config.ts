import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import {
  isLocalDevAuthEnabled,
  isOidcConfigured,
  verifyDevCredentials,
} from "./dev-auth";
import { isPublicPath } from "./auth-paths";

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (isOidcConfigured()) {
    providers.push({
      id: "nexauth",
      name: "NexAuth",
      type: "oidc",
      issuer: process.env.NEXAUTH_ISSUER!,
      clientId: process.env.NEXAUTH_CLIENT_ID!,
      clientSecret: process.env.NEXAUTH_CLIENT_SECRET!,
    });
  }

  if (isLocalDevAuthEnabled()) {
    providers.push(
      Credentials({
        id: "dev-login",
        name: "Local operator",
        credentials: {
          username: { label: "Username", type: "text" },
          password: { label: "Password", type: "password" },
        },
        authorize: async (credentials) => {
          const username = String(credentials?.username ?? "");
          const password = String(credentials?.password ?? "");
          if (!verifyDevCredentials(username, password)) return null;
          return {
            id: "local-operator",
            name: "Operator",
            email: `${username}@localhost`,
          };
        },
      }),
    );
  }

  if (providers.length === 0) {
    providers.push(
      Credentials({
        id: "unconfigured",
        name: "Unconfigured",
        credentials: {},
        authorize: async () => null,
      }),
    );
  }

  return providers;
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: buildProviders(),
  pages: { signIn: "/sign-in" },
  callbacks: {
    authorized({ request, auth }) {
      const pathname = request.nextUrl.pathname;
      if (isPublicPath(pathname)) return true;
      if (pathname.startsWith("/api/")) return true;
      return !!auth?.user?.id;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.name = token.name ?? "";
        session.user.email = token.email ?? "";
        session.user.image = token.picture;
        session.user.isClient = token.isClient === true;
      }
      return session;
    },
  },
};
