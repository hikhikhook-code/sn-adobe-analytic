"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormError {
  message: string;
  /** When set, the register form shows a follow-up link (e.g. to /auth/login). */
  action?: { href: string; label: string };
}

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const name = String(fd.get("name") ?? "").trim();

    // Cheap client-side guard so the user gets a clear message instead of
    // a generic zod "Invalid input" from the API.
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
          "Couldn't reach the server. Check your connection and try again.",
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

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      router.push("/auth/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>Free to start. No credit card required.</CardDescription>
      </CardHeader>
      <CardContent>
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

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-accent-blue hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
