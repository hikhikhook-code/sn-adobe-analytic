"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

interface FormError {
  message: string;
  /** When set, the login form shows a follow-up link (e.g. to /auth/register). */
  action?: { href: string; label: string };
}

/**
 * Allow-list of redirect targets so an attacker can't craft a malicious
 * `?callbackUrl=https://evil.example` and have us silently navigate there
 * after a successful sign-in. Same pattern as NextAuth's own
 * `trusted-host` check, applied to the in-app redirect we perform on the
 * client after `signIn(..., { redirect: false })`.
 */
function safeCallbackUrl(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = safeCallbackUrl(sp.get("callbackUrl"));
  // If the register page bounced the user here after "email already
  // registered", pre-fill the email field so they don't have to retype it.
  const prefilledEmail = sp.get("email") ?? "";
  const resetJustCompleted = sp.get("reset") === "1";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");

    if (!email || !password) {
      setError({ message: "Enter your email and password to sign in." });
      setLoading(false);
      return;
    }

    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
    } catch {
      setError({
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
      setLoading(false);
      return;
    }

    setLoading(false);
    if (!result) {
      setError({
        message:
          "Sign-in didn't complete. Please try again or contact support.",
      });
      return;
    }
    if (result.error) {
      // NextAuth's CredentialsProvider collapses both "no such user" and
      // "wrong password" into a single CredentialsSignin error for security
      // (so the form can't be used to enumerate registered emails). We
      // preserve that behavior but give the user a constructive next step:
      // a one-click path to the register page with the email prefilled,
      // AND a visible "Forgot password?" link already in the form above.
      setError({
        message:
          "That email and password don't match an account. Double-check your details, reset your password, or create a new account.",
        action: {
          href: `/auth/register?email=${encodeURIComponent(email)}`,
          label: "Create a new account",
        },
      });
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>
          Sign in to continue to SN Adobe Analytic
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {resetJustCompleted && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            Password updated. Sign in with your new password.
          </div>
        )}

        <GoogleSignInButton callbackUrl={callbackUrl} />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              Or continue with email
            </span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={prefilledEmail}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/auth/forgot-password"
                className="text-xs text-accent-blue hover:underline"
              >
                Forgot?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="space-y-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              <p>{error.message}</p>
              {error.action && (
                <Link
                  href={error.action.href}
                  className="inline-flex text-xs font-medium text-rose-900 underline underline-offset-2 hover:no-underline"
                >
                  {error.action.label} →
                </Link>
              )}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href="/auth/register"
            className="font-medium text-accent-blue hover:underline"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
