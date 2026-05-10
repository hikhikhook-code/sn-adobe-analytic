"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, X, ShieldCheck, Sparkles } from "lucide-react";
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
 * /pricing — PRD §7 plan comparison page.
 *
 * Foundation only (PR #17): no real checkout is wired. Each card's CTA
 * button is disabled with a "Coming soon" tooltip; the current plan is
 * highlighted based on `/api/user/entitlements`.
 *
 * Owner accounts (via `OWNER_EMAILS`) see a green banner at the top
 * confirming their bypass status — useful sanity check that the
 * whitelist is being read correctly.
 */

type PlanKey = "FREE" | "STARTER" | "PRO" | "ANNUAL";

interface PlanCard {
  key: PlanKey;
  name: string;
  priceLabel: string;
  priceSub: string;
  tagline: string;
  highlight?: boolean;
  features: Array<{ label: string; included: boolean | string }>;
  deviceLimit: string;
  searchesPerDay: string;
}

/**
 * Plan matrix — mirrors PRD §7. Kept in sync with
 * `src/lib/entitlements.ts` by convention; the server enforces the
 * *actual* gates, the table below is for display only.
 */
const PLANS: PlanCard[] = [
  {
    key: "FREE",
    name: "Free",
    priceLabel: "$0",
    priceSub: "forever",
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
    priceLabel: "$9",
    priceSub: "/month",
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
    priceLabel: "$29",
    priceSub: "/month",
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
    priceLabel: "$290",
    priceSub: "/year",
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

export default function PricingPage() {
  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/entitlements", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const j: EntitlementsResponse = await res.json();
        if (!cancelled) setEnt(j);
      })
      .catch(() => {
        // Anonymous callers just see the guest view — no error to show.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlan = ent?.entitlements.plan ?? null;
  const isOwner = ent?.entitlements.isOwner ?? false;

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
                gate is open regardless of your stored plan value. This
                whitelist is configured server-side via{" "}
                <code className="font-mono">OWNER_EMAILS</code>.
              </p>
            </div>
          </div>
        )}

        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <Sparkles className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p className="font-semibold">Payments — coming soon</p>
            <p className="text-xs text-amber-800">
              This PR ships the plan-gating foundation (owner whitelist,
              entitlement helper, per-route gates, daily-search budget).
              Stripe / PayPal checkout is deliberately deferred to a
              later release. Contact the operator to upgrade for now.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
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
                  {currentPlan === plan.key && !isOwner && (
                    <Badge variant="secondary">Current plan</Badge>
                  )}
                  {plan.highlight && (
                    <Badge variant="accent">Most popular</Badge>
                  )}
                </div>
                <div>
                  <span className="text-3xl font-bold">{plan.priceLabel}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    {plan.priceSub}
                  </span>
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
                      {feat.included === true ? (
                        <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                      ) : feat.included === false ? (
                        <X className="mt-0.5 h-4 w-4 flex-none text-muted-foreground/70" />
                      ) : (
                        <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                      )}
                      <span
                        className={cn(
                          feat.included === false &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {feat.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                  <p>
                    <span className="font-medium">
                      Searches / day:
                    </span>{" "}
                    {plan.searchesPerDay}
                  </p>
                  <p>
                    <span className="font-medium">Devices:</span>{" "}
                    {plan.deviceLimit}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={plan.highlight ? "accent" : "outline"}
                  className="w-full"
                  disabled
                  title="Payments are not yet enabled in this deployment."
                >
                  {currentPlan === plan.key && !isOwner
                    ? "Your current plan"
                    : "Coming soon"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

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
              shown on the <Link href="/settings" className="text-accent-blue hover:underline">Settings page</Link> and on the Plan Usage card of the{" "}
              <Link href="/dashboard" className="text-accent-blue hover:underline">Dashboard</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
