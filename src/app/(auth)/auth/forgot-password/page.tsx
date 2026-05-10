"use client";

import Link from "next/link";
import { useState } from "react";
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

interface ForgotResponse {
  ok?: boolean;
  message?: string;
  error?: string;
  devResetUrl?: string;
  devNote?: string;
}

/**
 * /auth/forgot-password
 *
 * Always shows a neutral success state after submit (regardless of
 * whether the email matched an account) — see the API route for the
 * enumeration-prevention reasoning.
 *
 * In dev the API response includes a clickable reset URL; we render it
 * in a clearly labeled "Dev mode" panel so the developer can proceed
 * without wiring a mailer. Production builds never see this panel
 * because the API never sends the field.
 */
export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [devNote, setDevNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setLoading(false);
      return;
    }

    const data: ForgotResponse = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSubmittedEmail(email);
    setDone(true);
    // These fields are only populated in dev-mode responses. Prod will
    // leave them undefined so the dev-only panel is never rendered.
    if (data.devResetUrl) setDevResetUrl(data.devResetUrl);
    if (data.devNote) setDevNote(data.devNote);
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Check your inbox</CardTitle>
          <CardDescription>
            If an account with <b>{submittedEmail}</b> exists, we&apos;ve emailed
            a reset link. It expires in 60 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Didn&apos;t get it? Check your spam folder, or{" "}
            <button
              type="button"
              className="font-medium text-accent-blue hover:underline"
              onClick={() => {
                setDone(false);
                setDevResetUrl(null);
                setDevNote(null);
              }}
            >
              try another email
            </button>
            .
          </p>

          {devResetUrl && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Dev mode — reset link</p>
              {devNote && <p className="mt-1 text-amber-800">{devNote}</p>}
              <Link
                href={devResetUrl}
                className="mt-2 inline-block break-all font-mono text-amber-900 underline"
              >
                {devResetUrl}
              </Link>
            </div>
          )}

          <p className="text-center">
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
        <CardTitle className="text-2xl">Forgot password</CardTitle>
        <CardDescription>
          Enter the email on your account and we&apos;ll send a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
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
            {loading ? "Sending..." : "Send reset link"}
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
