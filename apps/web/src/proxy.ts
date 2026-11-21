import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { gateRequest } from "@/lib/auth-paths";

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const decision = gateRequest(req.nextUrl.pathname, !!req.auth?.user?.id, {
    isClient: req.auth?.user?.isClient === true,
  });

  if (decision.type === "unauthorized") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (decision.type === "redirect") {
    return NextResponse.redirect(new URL(decision.to, req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|widget.js|public).*)",
  ],
};
