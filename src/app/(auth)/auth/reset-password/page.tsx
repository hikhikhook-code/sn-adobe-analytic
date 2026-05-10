"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
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

/**
 * /auth/reset-password?uid=<userId>&token=<plaintext>
 *
 * The token is passed in the query string (the standard pattern for
 * email-based reset links). We never log it on the client and never
 * persist it in local/session storage — it's only used once, POSTed to
 * `/api/auth/reset-password`, and discarded.
 *
 * Success path redirects to /auth/login?reset=1 so the login page can
 * surface a one-time "Password updated, please sign in" banner without
 * having to carry any mutable state across the reset→login transition.
 */
function ResetInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const uid = sp.get("uid") ?? "";
  const token = sp.get("token") ?? "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingTokenFromUrl = !uid || !token;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      setLoading(false);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match. Retype both fields.");
      setLoading(false);
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, token, password }),
      });
    } catch {
      setError(
        "Couldn't reach the server. Check your connection and try again.",
      );
      setLoading(false);
      return;
    }

    const data: { ok?: boolean; error?: string } = await res
      .json()
      .catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Invalid or expired reset link.");
      return;
    }

    router.push("/auth/login?reset=1");
    router.refresh();
  }

  if (missingTokenFromUrl) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Invalid reset link</CardTitle>
          <CardDescription>
            Your reset link is missing the token or expired. Request a fresh
            one to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Button asChild className="w-full">
            <Link href="/auth/forgot-password">Request a new reset link</Link>
          </Button>
          <p className="text-center text-muted-foreground">
            <Link
              href="/auth/login"
              className="font-medium text-accent-blue hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>Pick a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Minimum 8 characters.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Updating..." : "Update password"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/auth/login"
            className="font-medium text-accent-blue hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
