import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const umamiSrc = process.env.NEXT_PUBLIC_UMAMI_SRC || "https://analytics.relay.dev/script.js";
const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const umamiTag = process.env.NEXT_PUBLIC_UMAMI_TAG || "marketing-site";
const umamiHost = process.env.NEXT_PUBLIC_UMAMI_HOST;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Relay — AI Agent Platform",
    template: "%s | Relay",
  },
  description: "Customer agents on WhatsApp, Instagram, and the widget. Operator agents for your team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {umamiWebsiteId && (
            <>
              <Script
                src={umamiSrc}
                data-website-id={umamiWebsiteId}
                data-tag={umamiTag}
                data-host-url={umamiHost}
                strategy="afterInteractive"
              />
              <AnalyticsProvider />
            </>
          )}
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
