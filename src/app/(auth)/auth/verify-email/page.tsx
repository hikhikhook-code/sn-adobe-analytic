"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface VerifyState {
  status: "loading" | "success" | "error";
  message: string;
}

function VerifyEmailInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [state, setState] = useState<VerifyState>({
    status: "loading",
    message: "Verifying your email...",
  });

  useEffect(() => {
    async function verify() {
      const token = sp.get("token");
      const email = sp.get("email");

      if (!token || !email) {
        setState({
          status: "error",
          message: "Invalid verification link. Missing token or email.",
        });
        return;
      }

      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email }),
        });

        if (!res.ok) {
          const data: { error?: string } = await res.json().catch(() => ({}));
          setState({
            status: "error",
            message: data.error || "Failed to verify email. Please try again.",
          });
          return;
        }

        setState({
          status: "success",
          message: "Email verified successfully! Redirecting to login...",
        });

        // Redirect to login after 2 seconds
        setTimeout(() => {
          router.push(`/auth/login?email=${encodeURIComponent(email)}`);
        }, 2000);
      } catch (error) {
        setState({
          status: "error",
          message: "An error occurred. Please try again.",
        });
      }
    }

    verify();
  }, [sp, router]);

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Email Verification</CardTitle>
        <CardDescription>Verifying your email address...</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`rounded-md px-4 py-3 text-center ${
            state.status === "success"
              ? "bg-green-50 text-green-700"
              : state.status === "error"
                ? "bg-rose-50 text-rose-700"
                : "bg-blue-50 text-blue-700"
          }`}
        >
          <p className="text-sm font-medium">{state.message}</p>
        </div>

        {state.status === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The verification link may have expired or is invalid.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline" className="flex-1">
                <Link href="/auth/register">Register Again</Link>
              </Button>
              <Button asChild className="flex-1">
                <Link href="/auth/login">Go to Login</Link>
              </Button>
            </div>
          </div>
        )}

        {state.status === "success" && (
          <Button asChild className="w-full">
            <Link href="/auth/login">Go to Login</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
