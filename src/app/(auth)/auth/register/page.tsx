"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
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
  action?: { href: string; label: string };
}

function RegisterInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [success, setSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const prefilledEmail = sp.get("email") ?? "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const name = String(fd.get("name") ?? "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError({ message: "Please enter a valid email address." });
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setError({
        message: "Password must be at least 8 characters long.",
      });
      setLoading(false);
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
    } catch {
      setError({
        message:
          "Couldn''t reach the server. Check your connection and try again.",
      });
      setLoading(false);
      return;
    }

    if (!res.ok) {
      const data: { error?: string; code?: string } = await res
        .json()
        .catch(() => ({}));

      if (res.status === 409 || data.code === "email_taken") {
        setError({
          message:
            "That email is already registered. Try signing in instead.",
          action: {
            href: `/auth/login?email=${encodeURIComponent(email)}`,
            label: "Go to sign in",
          },
        });
      } else if (res.status === 400) {
        setError({
          message:
            data.error ??
            "Some details are invalid. Double-check your email and password.",
        });
      } else {
        setError({
          message:
            data.error ??
            "Could not create your account. Please try again in a moment.",
        });
      }
      setLoading(false);
      return;
    }

    setSuccess(true);
    setRegisteredEmail(email);
    setLoading(false);
  }

  if (success) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription>
            We''ve sent a verification link to your inbox
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-green-50 px-4 py-3 text-center">
            <p className="text-sm font-medium text-green-700">
              Account created successfully!
            </p>
            <p className="mt-1 text-sm text-green-600">
              Please check your email at <strong>{registeredEmail}</strong> and
              click the verification link to complete your registration.
            </p>
          </div>

          <div className="space-y-2 rounded-md bg-blue-50 px-4 py-3">
            <p className="text-sm font-medium text-blue-700">Didn''t receive the email?</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-blue-600">
              <li>Check your spam or junk folder</li>
              <li>Make sure you entered the correct email address</li>
              <li>The link will expire in 24 hours</li>
            </ul>
          </div>

          <Button asChild className="w-full">
            <Link href="/auth/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>
          Free to start. No credit card required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton callbackUrl="/dashboard" />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              Or sign up with email
            </span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" />
          </div>
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
            <Label htmlFor="password">Password</Label>
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
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/auth/login"
            className="font-medium text-accent-blue hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}
