import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Sparkles } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { authOptions } from "@/lib/auth";

// If the caller is already signed in, send them into the app instead of
// letting them re-render the login / register form. This handles the
// "I bookmarked /auth/login and came back tomorrow" case cleanly — the
// middleware allow-lists `/auth/*` (so login itself stays reachable
// during the sign-in flow), which means we need this layout-level
// check to catch an already-authenticated visitor.
//
// We redirect to `/dashboard` to match the root redirect in
// `middleware.ts`. The password-reset / device-limit / forgot-password
// pages share this layout; sending a signed-in user to /dashboard from
// those is slightly lossy (e.g. they might genuinely want to change
// password) but the /settings page owns password management today, so
// bouncing them in is the honest default.
//
// This layout has no client-only code, so it remains a React Server
// Component and the session read happens on the server with no flash
// of login form before the redirect.
export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-lavender-100">
      <header className="flex items-center justify-between p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-base font-semibold tracking-tight text-navy">
            {APP_NAME}
          </span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
