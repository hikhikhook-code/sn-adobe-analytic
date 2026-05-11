"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /billing/success — Post-checkout landing page (PR #26).
 *
 * This page is shown after Stripe redirects the user back on a
 * successful payment. It does NOT upgrade the user's plan — that
 * happens exclusively via the webhook. This page simply confirms
 * the payment was submitted and tells the user their plan will
 * update momentarily.
 */
export default function BillingSuccessPage() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  return (
    <>
      <TopBar title="Billing" subtitle="Payment successful" />
      <div className="flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <CardTitle>Payment Successful</CardTitle>
            <CardDescription>
              Thank you for upgrading your plan!
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center text-sm">
            <p className="text-muted-foreground">
              Your payment has been processed. Your plan will be updated
              within a few moments once the payment is confirmed.
            </p>
            <p className="text-xs text-muted-foreground">
              If your plan doesn&apos;t update within a minute, try
              refreshing the page or signing out and back in.
            </p>
            {sessionId && (
              <p className="text-[11px] text-muted-foreground font-mono">
                Session: {sessionId.slice(0, 20)}…
              </p>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <Button asChild>
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings">View Account Settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
