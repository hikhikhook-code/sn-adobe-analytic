"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GOOGLE_OAUTH_ENABLED_CLIENT } from "@/lib/auth-client";

/**
 * Sign in with Google button.
 *
 * Renders in one of three states:
 *
 *   1. Enabled — `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED="1"` AND the server's
 *      GoogleProvider env is set. Clicking kicks off the standard
 *      `next-auth` redirect flow to Google's consent screen.
 *   2. Disabled (not configured) — the build-time flag is off. The button
 *      stays visible so the UI doesn't shift between deployments, but it's
 *      disabled with a tooltip explaining it's unavailable in this
 *      deployment. This is the PRD's "graceful disable" behavior.
 *   3. Loading — the user just clicked and the provider page hasn't
 *      redirected yet. Prevents double-clicks.
 *
 * We don't try to detect server-side-only misconfiguration on the client
 * (that would require a round-trip per page load). The deploy is expected
 * to set `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` in lockstep with the server
 * env vars; mismatches fail closed, which is the safe default.
 */
export function GoogleSignInButton({
  callbackUrl,
}: {
  callbackUrl?: string;
}) {
  const [loading, setLoading] = useState(false);
  const enabled = GOOGLE_OAUTH_ENABLED_CLIENT;

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={!enabled || loading}
        aria-disabled={!enabled || loading}
        title={
          enabled
            ? undefined
            : "Sign in with Google is not configured for this deployment."
        }
        onClick={() => {
          if (!enabled) return;
          setLoading(true);
          signIn("google", { callbackUrl: callbackUrl ?? "/dashboard" }).catch(
            () => setLoading(false),
          );
        }}
      >
        <GoogleLogo className="h-4 w-4" aria-hidden="true" />
        {loading ? "Redirecting..." : "Continue with Google"}
      </Button>
      {!enabled && (
        <p className="text-center text-[11px] text-muted-foreground">
          Google sign-in is not configured for this deployment.
        </p>
      )}
    </div>
  );
}

/**
 * Compact inline SVG for Google's "G" mark. Inlined so the auth pages
 * don't need an extra network fetch for a single icon.
 */
function GoogleLogo({
  className,
  ...rest
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        fill="#4285F4"
        d="M45 24.5c0-1.6-.1-2.7-.3-3.9H24v7.4h12c-.3 2-1.6 5-4.6 7.1l-.1.3 6.7 5.2.4.1c4.2-3.9 6.6-9.7 6.6-16.2z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11.1-2 14.8-5.4l-7.1-5.5c-1.9 1.3-4.4 2.2-7.7 2.2-5.9 0-10.9-3.9-12.7-9.3l-.3 0-7 5.4-.1.3C7.5 41 15.1 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.3 28c-.5-1.3-.7-2.7-.7-4s.3-2.7.7-4l-.1-.3-7.1-5.5-.2.1C2.4 17 1.5 20.4 1.5 24s.9 7 2.4 9.7l7.4-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.4c4.2 0 7 1.8 8.6 3.3l6.3-6.1C34.9 4.2 29.9 2 24 2 15.1 2 7.5 7 3.9 14.3l7.4 5.7C13.1 14.3 18.1 10.4 24 10.4z"
      />
    </svg>
  );
}
