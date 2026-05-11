"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, X, ShieldCheck } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Entitlements } from "@/lib/entitlements";

/**
 * /pricing — Plan comparison + checkout page (PR #26).
 *
 * Supports USD and IDR display currencies. IDR prices are converted
 * from USD using NEXT_PUBLIC_USD_TO_IDR_RATE for display only. Actual
 * checkout uses Stripe Price IDs configured per currency.
 */

type PlanKey = "FREE" | "STARTER" | "PRO" | "ANNUAL";
type Currency = "USD" | "IDR";

/** USD prices in cents — source of truth matching src/lib/pricing.ts */
const PLAN_PRICES_USD_CENTS: Record<PlanKey, number> = {
  FREE: 0,
  STARTER: 900,
  PRO: 2900,
  ANNUAL: 1900,
};

function getUsdToIdrRate(): number {
  const envRate = process.env.NEXT_PUBLIC_USD_TO_IDR_RATE;
  if (envRate) {
    const parsed = Number(envRate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 16_000; // Safe default for local/demo display only
}

function formatPrice(cents: number, currency: Currency): string {
  if (currency === "USD") {
    const dollars = cents / 100;
    return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  }
  const rate = getUsdToIdrRate();
  const idr = Math.round((cents / 100) * rate / 1000) * 1000;
  return `Rp${idr.toLocaleString("id-ID")}`;
}

interface PlanCard {
  key: PlanKey;
  name: string;
  billingPeriod: string;
  tagline: string;
  highlight?: boolean;
  features: Array<{ label: string; included: boolean }>;
  deviceLimit: string;
  searchesPerDay: string;
}

const PLANS: PlanCard[] = [
  {
    key: "FREE",
    name: "Free",
    billingPeriod: "forever",
    tagline: "Try the app with demo data and 2 searches per day.",
    searchesPerDay: "2",
    deviceLimit: "1",
    features: [
      { label: "Keyword search (2 / day)", included: true },
      { label: "Similar Image Search", included: false },
      { label: "Export CSV", included: false },
      { label: "Save & Track Favorites", included: false },
      { label: "Portfolio Tracker", included: false },
      { label: "Heat Map", included: false },
      { label: "Trending Insights", included: false },
      { label: "Performance Analytics", included: false },
    ],
  },
  {
    key: "STARTER",
    name: "Starter",
    billingPeriod: "/ month",
    tagline: "For contributors who search and export regularly.",
    searchesPerDay: "50",
    deviceLimit: "1",
    features: [
      { label: "Keyword search (50 / day)", included: true },
      { label: "Similar Image Search", included: true },
      { label: "Export CSV", included: true },
      { label: "Save & Track Favorites", included: true },
      { label: "Portfolio Tracker", included: false },
      { label: "Heat Map", included: false },
      { label: "Trending Insights", included: false },
      { label: "Performance Analytics", included: false },
    ],
  },
  {
    key: "PRO",
    name: "Pro",
    billingPeriod: "/ month",
    tagline: "Unlock full analytics for serious contributors.",
    highlight: true,
    searchesPerDay: "Unlimited",
    deviceLimit: "3",
    features: [
      { label: "Keyword search (unlimited)", included: true },
      { label: "Similar Image Search", included: true },
      { label: "Export CSV", included: true },
      { label: "Save & Track Favorites", included: true },
      { label: "Portfolio Tracker", included: true },
      { label: "Heat Map", included: true },
      { label: "Trending Insights", included: true },
      { label: "Performance Analytics", included: true },
    ],
  },
  {
    key: "ANNUAL",
    name: "Annual",
    billingPeriod: "/ month (billed annually)",
    tagline: "All Pro features, two months free, 5 device slots.",
    searchesPerDay: "Unlimited",
    deviceLimit: "5",
    features: [
      { label: "Keyword search (unlimited)", included: true },
      { label: "Similar Image Search", included: true },
      { label: "Export CSV", included: true },
      { label: "Save & Track Favorites", included: true },
      { label: "Portfolio Tracker", included: true },
      { label: "Heat Map", included: true },
      { label: "Trending Insights", included: true },
      { label: "Performance Analytics", included: true },
    ],
  },
];

interface EntitlementsResponse {
  signedIn: boolean;
  plan: string | null;
  entitlements: Entitlements;
}

function detectDefaultCurrency(): Currency {
  if (typeof navigator === "undefined") return "USD";
  const lang = navigator.language || "";
  if (lang.startsWith("id") || lang.includes("-ID")) return "IDR";
  return "USD";
}

export default function PricingPage() {
  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [checkoutLoading, setCheckoutLoading] = useState<PlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    setCurrency(detectDefaultCurrency());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/entitlements", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const j: EntitlementsResponse = await res.json();
        if (!cancelled) setEnt(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlan = ent?.entitlements.plan ?? null;
  const isOwner = ent?.entitlements.isOwner ?? false;
  const signedIn = ent?.signedIn ?? false;

  const handleCheckout = async (planKey: PlanKey) => {
    setCheckoutLoading(planKey);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: planKey, currency }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setCheckoutError(data.message || "Checkout failed.");
    } catch {
      setCheckoutError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  };

  return (
    <>
      <TopBar title="Pricing" subtitle="Choose your plan" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Pricing & plans"
          description="All plans include the provider-aware Search & Dashboard foundation. Paid tiers unlock analytics, export, and tracking."
        />

        {isOwner && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <p className="font-semibold">Owner access active</p>
              <p className="text-xs text-emerald-800">
                Plan limits are bypassed for your account. Every feature
                gate is open regardless of your stored plan value.
              </p>
            </div>
          </div>
        )}

        {/* Currency selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Display currency:</span>
          <div className="inline-flex rounded-md border">
            <button
              type="button"
              onClick={() => setCurrency("USD")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-l-md transition-colors",
                currency === "USD"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              USD
            </button>
            <button
              type="button"
              onClick={() => setCurrency("IDR")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-r-md border-l transition-colors",
                currency === "IDR"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              IDR
            </button>
          </div>
          {currency === "IDR" && (
            <span className="text-[11px] text-muted-foreground">
              Converted from USD at ~{getUsdToIdrRate().toLocaleString()} rate (display only)
            </span>
          )}
        </div>

        {checkoutError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {checkoutError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const priceCents = PLAN_PRICES_USD_CENTS[plan.key];
            const priceDisplay = priceCents > 0
              ? formatPrice(priceCents, currency)
              : "$0";
            const isCurrentPlan = currentPlan === plan.key && !isOwner;
            const isPurchasable = plan.key !== "FREE" && !isCurrentPlan && !isOwner;

            return (
              <Card
                key={plan.key}
                className={cn(
                  "flex flex-col overflow-hidden",
                  plan.highlight &&
                    "border-accent-blue shadow-md ring-2 ring-accent-blue/30",
                )}
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    {isCurrentPlan && (
                      <Badge variant="secondary">Current plan</Badge>
                    )}
                    {plan.highlight && (
                      <Badge variant="accent">Most popular</Badge>
                    )}
                  </div>
                  <div>
                    <span className="text-3xl font-bold">{priceDisplay}</span>
                    {priceCents > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {plan.billingPeriod}
                      </span>
                    )}
                    {priceCents === 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        forever
                      </span>
                    )}
                  </div>
                  <CardDescription>{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <ul className="space-y-1.5 text-sm">
                    {plan.features.map((feat) => (
                      <li
                        key={feat.label}
                        className="flex items-start gap-2"
                      >
                        {feat.included ? (
                          <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                        ) : (
                          <X className="mt-0.5 h-4 w-4 flex-none text-muted-foreground/70" />
                        )}
                        <span
                          className={cn(
                            !feat.included && "text-muted-foreground line-through",
                          )}
                        >
                          {feat.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                    <p>
                      <span className="font-medium">Searches / day:</span>{" "}
                      {plan.searchesPerDay}
                    </p>
                    <p>
                      <span className="font-medium">Devices:</span>{" "}
                      {plan.deviceLimit}
                    </p>
                  </div>
                  {isPurchasable && signedIn ? (
                    <Button
                      type="button"
                      variant={plan.highlight ? "accent" : "outline"}
                      className="w-full"
                      disabled={checkoutLoading === plan.key}
                      onClick={() => handleCheckout(plan.key)}
                    >
                      {checkoutLoading === plan.key
                        ? "Redirecting…"
                        : `Upgrade to ${plan.name}`}
                    </Button>
                  ) : isPurchasable && !signedIn ? (
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/auth/login?callbackUrl=%2Fpricing">
                        Sign in to upgrade
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled
                    >
                      {isCurrentPlan
                        ? "Your current plan"
                        : isOwner
                          ? "Owner bypass active"
                          : "Free forever"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {currency === "IDR" && (
          <p className="text-xs text-muted-foreground text-center">
            IDR price is converted from USD for display purposes only.
            Final checkout price depends on the configured Stripe price for IDR.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
            <CardDescription>
              Payments are processed securely via Stripe. PayPal checkout
              is coming soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              After clicking &quot;Upgrade&quot;, you&apos;ll be redirected to
              Stripe&apos;s secure checkout page. Your plan activates
              automatically once payment is confirmed via webhook.
            </p>
            <p>
              <strong>PayPal:</strong> Coming soon. We&apos;re working on
              adding PayPal as an alternative payment method.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What counts against your daily search limit?</CardTitle>
            <CardDescription>
              We count <em>successful</em> keyword and similar-image
              searches. Browsing cached dashboards, viewing saved assets,
              and re-running an existing saved search do NOT count.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Your counter resets at 00:00 UTC daily. Current usage is
              shown on the{" "}
              <Link href="/settings" className="text-accent-blue hover:underline">
                Settings page
              </Link>{" "}
              and on the Plan Usage card of the{" "}
              <Link href="/dashboard" className="text-accent-blue hover:underline">
                Dashboard
              </Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
