"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";

interface PlanUsageCardProps {
  plan: string | null | undefined;
  searchesUsedToday: number;
  /** When null, plan gating isn't enforced yet and we show the honest
   *  preview copy. */
  dailyLimit?: number | null;
  signedIn: boolean;
}

/**
 * PRD §5.4 "Search Usage" card — preview variant.
 *
 * Plan gating (daily/monthly search limits enforced at the API layer
 * with Stripe / PayPal / Cryptomus billing) is explicitly out of scope
 * for PR #14, per the brief. We render this card as a preview: it
 * honestly shows the signed-in user's plan + searches used today (from
 * `/api/dashboard`), but labels itself "Plan limits not fully enabled
 * yet" when `dailyLimit` is null so we never imply a limit is being
 * enforced when it isn't.
 */
export function PlanUsageCard({
  plan,
  searchesUsedToday,
  dailyLimit,
  signedIn,
}: PlanUsageCardProps) {
  const limitKnown = typeof dailyLimit === "number" && dailyLimit > 0;
  const pct = limitKnown
    ? Math.min(100, Math.round((searchesUsedToday / dailyLimit) * 100))
    : 0;
  const planLabel = (plan ?? "Free").toString().toLowerCase();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-accent-blue" />
              Plan usage preview
            </CardTitle>
            <CardDescription>
              Search activity against your current plan.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="capitalize">
            {planLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!signedIn ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
            Sign in to see your plan usage. A preview is shown once plan
            gating is enabled.
          </div>
        ) : (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">Searches today</span>
                <span className="text-muted-foreground">
                  {formatNumber(searchesUsedToday)}
                  {limitKnown
                    ? ` / ${formatNumber(dailyLimit!)}`
                    : ""}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={limitKnown ? pct : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    limitKnown
                      ? pct > 85
                        ? "bg-rose-500"
                        : pct > 60
                          ? "bg-amber-500"
                          : "bg-accent-blue"
                      : "bg-accent-blue/30",
                  )}
                  style={{
                    width: limitKnown
                      ? `${pct}%`
                      : // Show an indeterminate fill so the bar doesn't
                        // look empty and confuse users into thinking they
                        // have 0/0 usage.
                        `${Math.min(15, searchesUsedToday * 5)}%`,
                  }}
                />
              </div>
            </div>
            {!limitKnown ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                <span className="font-semibold uppercase tracking-wide">
                  Preview
                </span>{" "}
                Plan limits are not fully enabled yet. Numbers are
                informational only.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">Manage plan</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/search">Run a search</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
