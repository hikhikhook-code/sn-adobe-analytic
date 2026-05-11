import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { logConfigStatus } from "@/lib/config-status";

// Emit a one-line config summary to server logs the first time the root
// layout module loads in this worker. Helps the operator confirm — from
// Vercel's deployment logs — which env vars and feature flags this
// particular deploy picked up, without echoing any secret VALUES.
// Safe to call unconditionally: the helper is a no-op during
// `next build` (phase-production-build) and is deduped via a
// globalThis flag so parallel handler imports only log once.
logConfigStatus();

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "SN Adobe Analytic — Adobe Stock analytics for contributors",
  description:
    "Search keywords, track contributors, see download counts and performance scores. Built for Adobe Stock contributors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
