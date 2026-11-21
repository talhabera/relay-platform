"use client";

import "./globals.css";

import { AuthStage } from "@/components/v2/shell/system-states";

import { GlobalErrorCard } from "./global-error-card";

/** Replaces the root layout when it throws, so it renders its own html/body (dark default). */
export default function GlobalError() {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <AuthStage>
          <GlobalErrorCard onReload={() => window.location.reload()} />
        </AuthStage>
      </body>
    </html>
  );
}
