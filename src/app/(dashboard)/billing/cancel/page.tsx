"use client";

import Link from "next/link";
import { XCircle } from "lucide-react";
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
 * /billing/cancel — Post-checkout cancellation page (PR #26).
 *
 * Shown when the user clicks "Back" or closes the Stripe checkout
 * window without completing payment. No plan changes occur.
 */
export default function BillingCancelPage() {
  return (
    <>
      <TopBar title="Billing" subtitle="Checkout canceled" />
      <div className="flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <XCircle className="h-6 w-6 text-slate-500" />
            </div>
            <CardTitle>Checkout Canceled</CardTitle>
            <CardDescription>
              No payment was processed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center text-sm">
            <p className="text-muted-foreground">
              You canceled the checkout process. Your current plan has not
              changed. You can try again anytime from the Pricing page.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button asChild>
                <Link href="/pricing">Back to Pricing</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
