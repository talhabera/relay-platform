export function isAuthPath(pathname: string): boolean {
  return pathname === "/sign-in" || pathname === "/sign-up";
}

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return true;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return true;
  if (isAuthPath(pathname)) return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/widget" || pathname.startsWith("/api/widget/")) return true;
  if (pathname === "/api/webhooks" || pathname.startsWith("/api/webhooks/")) {
    return true;
  }
  // Handoff quick links: the token is the credential (recipients may have no account).
  if (pathname.startsWith("/h/") || pathname.startsWith("/api/h/")) return true;
  // Report share links (S89): the HMAC-signed token is the credential.
  if (pathname.startsWith("/api/reports/shared/")) return true;
  if (pathname === "/widget.js") return true;
  if (
    pathname === "/company-widget" ||
    pathname.startsWith("/company-widget/")
  ) {
    return true;
  }
  return false;
}

/** Where a client user lands after login, and from any non-portal app route. */
export const CLIENT_HOME_PATH = "/client/reports";

export function isClientPortalPath(pathname: string): boolean {
  return pathname === "/client" || pathname.startsWith("/client/");
}

function isClientAllowedPath(pathname: string): boolean {
  if (isClientPortalPath(pathname)) return true;
  // Portal APIs authorize with requireClientAccess; other APIs refuse client
  // rows in their own helpers.
  if (pathname.startsWith("/api/")) return true;
  // Public quick-link page stays outside both shells.
  if (pathname.startsWith("/h/")) return true;
  return false;
}

export type GateOptions = {
  /** The signed-in user holds a `client` membership. */
  isClient?: boolean;
};

export type GateDecision =
  | { type: "next" }
  | { type: "redirect"; to: string }
  | { type: "unauthorized" };

export function gateRequest(
  pathname: string,
  isLoggedIn: boolean,
  options: GateOptions = {},
): GateDecision {
  const isClient = isLoggedIn && options.isClient === true;
  if (isAuthPath(pathname)) {
    if (isLoggedIn) {
      return { type: "redirect", to: isClient ? CLIENT_HOME_PATH : "/home" };
    }
    return { type: "next" };
  }
  if (isPublicPath(pathname)) return { type: "next" };
  if (!isLoggedIn) {
    if (pathname.startsWith("/api/")) return { type: "unauthorized" };
    return { type: "redirect", to: "/sign-in" };
  }
  if (isClient && !isClientAllowedPath(pathname)) {
    return { type: "redirect", to: CLIENT_HOME_PATH };
  }
  return { type: "next" };
}
