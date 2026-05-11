import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// This route is authenticated via `src/middleware.ts`, which already
// redirects `/` to `/dashboard` (authenticated) or `/auth/login`
// (unauthenticated) before any request reaches this handler.
//
// We keep this page component as a belt-and-braces fallback for any
// code path that might bypass middleware (e.g. a custom Vercel rewrite,
// or a future preview deployment that disables middleware). It does a
// server-side `getServerSession` check so the behavior matches the
// middleware exactly instead of blindly dumping guests onto `/search`
// the way the pre-PR #28 version did.
//
// `force-dynamic` opts out of static optimization — we always want the
// session-aware branch, never a cached 302.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/dashboard");
  }
  redirect("/auth/login");
}
