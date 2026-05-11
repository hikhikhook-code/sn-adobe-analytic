"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { ShieldCheck, Database, RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
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
import type { Entitlements } from "@/lib/entitlements";

interface ProviderHealthResponse {
  providers: Array<{
    id: string;
    name: string;
    status: "configured" | "not_configured" | "disabled";
    availability: "available" | "unavailable" | "unknown";
    notice?: string;
    lastSuccessfulFetch?: string;
  }>;
  cache: {
    searchCount: number;
    assetCount: number;
    contributorCount: number;
    searchTtlHours: number;
    assetTtlDays: number;
    contributorTtlDays: number;
  };
  cacheStats: {
    searches: { total: number; fresh: number; stale: number };
    assets: { total: number; fresh: number; stale: number };
    contributors: { total: number; fresh: number; stale: number };
  };
  activeProvider: string;
  demoModeAvailable: boolean;
  manualImportAvailable: boolean;
}

interface DeviceUsageResponse {
  plan: string;
  limit: number;
  activeCount: number;
  overLimit: boolean;
}

interface EntitlementsResponse {
  signedIn: boolean;
  plan: string | null;
  role: "USER" | "OWNER" | "ADMIN";
  ownerAccessGrantedAt: string | null;
  ownerAccessSource: string | null;
  searchesUsedToday: number;
  searchResetAt: string | null;
  entitlements: Entitlements;
}

/**
 * Human-readable label for the `ownerAccessSource` string. Kept out of
 * the DB / API layer so the server can keep passing raw tokens and the
 * UI can rephrase them without a migration.
 */
function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "env_bootstrap":
      return "env bootstrap";
    case "manual":
      return "database (manual)";
    case "seed":
      return "database (seed)";
    default:
      return "database";
  }
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [devices, setDevices] = useState<DeviceUsageResponse | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const fetchHealth = useCallback(() => {
    fetch("/api/providers/health", { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) {
          const j: ProviderHealthResponse = await res.json();
          setHealth(j);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetchHealth();
  }, [status, fetchHealth]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/devices", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setDevicesError("Couldn't load device list.");
          return;
        }
        const j: DeviceUsageResponse = await res.json();
        if (!cancelled) setDevices(j);
      })
      .catch(() => {
        if (!cancelled) setDevicesError("Couldn't load device list.");
      });
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
  }, [status]);

  const searchesUsed = ent?.searchesUsedToday ?? 0;
  const maxSearches = ent?.entitlements.maxSearchesPerDay ?? 2;
  const isUnlimited = maxSearches === "unlimited";
  const searchesRemaining = isUnlimited
    ? null
    : Math.max(0, (maxSearches as number) - searchesUsed);
  const isOwner = ent?.entitlements.isOwner ?? false;
  const planLabel = ent?.entitlements.planLabel ?? devices?.plan ?? "Free";

  const handleCacheRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/providers/health", { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        setRefreshMsg("Cache marked for refresh. Next searches will fetch fresh data.");
        fetchHealth();
      } else {
        setRefreshMsg(j.message ?? "Could not refresh cache.");
      }
    } catch {
      setRefreshMsg("Network error. Could not reach the server.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <TopBar title="Settings" subtitle="Manage your account" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Account"
          description="Profile, plan, devices, and danger zone."
        />

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {status === "loading" ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : session?.user ? (
              <>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Name
                  </p>
                  <p className="mt-1">{session.user.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Email
                  </p>
                  <p className="mt-1">{session.user.email}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Plan
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{planLabel}</Badge>
                    {isOwner && (
                      <Badge variant="success" className="gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {ent?.role === "ADMIN"
                          ? "Admin access"
                          : "Owner access"}
                      </Badge>
                    )}
                  </div>
                  {isOwner && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Role: <span className="font-medium">{ent?.role}</span>
                      {" · "}Source:{" "}
                      <span className="font-medium">
                        {sourceLabel(ent?.ownerAccessSource)}
                      </span>
                      {ent?.ownerAccessGrantedAt && (
                        <>
                          {" · "}Granted{" "}
                          <span className="font-medium">
                            {new Date(
                              ent.ownerAccessGrantedAt,
                            ).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                  {isOwner && ent?.ownerAccessSource === "env_bootstrap" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Your role persists in the database. Removing your
                      email from <code className="font-mono">OWNER_EMAILS</code>{" "}
                      will not revoke access — edit the user row directly
                      to downgrade.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Not signed in.</p>
            )}
          </CardContent>
        </Card>

        {session?.user && (
          <Card>
            <CardHeader>
              <CardTitle>Plan usage</CardTitle>
              <CardDescription>
                Per-day search budget for your{" "}
                <span className="font-medium">{planLabel}</span> plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {isOwner ? (
                <p>
                  <Badge variant="success" className="mr-2">
                    Unlimited
                  </Badge>
                  Owner accounts bypass the daily-search budget.
                </p>
              ) : isUnlimited ? (
                <p>
                  <Badge variant="accent" className="mr-2">
                    Unlimited
                  </Badge>
                  Searches today:{" "}
                  <span className="font-medium">{searchesUsed}</span>
                </p>
              ) : (
                <>
                  <p>
                    <span className="font-medium">
                      {searchesUsed}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium">
                      {maxSearches as number}
                    </span>{" "}
                    searches used today
                    {searchesRemaining === 0 && (
                      <Badge variant="warning" className="ml-2">
                        Limit reached
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Counter resets at 00:00 UTC. Upgrade your plan for
                    more searches per day.
                  </p>
                </>
              )}
              <Button asChild variant="outline">
                <Link href="/pricing">View plans</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {session?.user && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                Data Sources
              </CardTitle>
              <CardDescription>
                Provider health, cache status, and active data source.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!health ? (
                <p className="text-muted-foreground">Loading provider status…</p>
              ) : (
                <>
                  {/* Active provider */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Active Provider
                    </p>
                    <p className="mt-1 font-medium capitalize">
                      {health.activeProvider === "mock"
                        ? "Mock / Demo"
                        : health.activeProvider === "manual"
                          ? "Manual Import"
                          : health.activeProvider === "official" || health.activeProvider === "public"
                            ? "Public Metadata"
                            : health.activeProvider}
                    </p>
                  </div>

                  {/* Provider list */}
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Providers
                    </p>
                    {health.providers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-start gap-2 rounded-md border p-2"
                      >
                        {p.availability === "available" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : p.availability === "unavailable" ? (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                        ) : (
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-xs">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {p.notice}
                          </p>
                          {p.lastSuccessfulFetch && (
                            <p className="text-[11px] text-muted-foreground">
                              Last fetch:{" "}
                              {new Date(p.lastSuccessfulFetch).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            p.status === "configured"
                              ? "success"
                              : p.status === "disabled"
                                ? "warning"
                                : "secondary"
                          }
                          className="shrink-0 text-[10px]"
                        >
                          {p.status === "configured"
                            ? "Configured"
                            : p.status === "disabled"
                              ? "Disabled"
                              : "Not configured"}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {/* Cache summary */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Cache
                    </p>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded border p-2">
                        <p className="text-lg font-semibold">
                          {health.cacheStats.searches.total}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Searches
                          {health.cacheStats.searches.fresh > 0 && (
                            <span className="text-emerald-600">
                              {" "}({health.cacheStats.searches.fresh} fresh)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-lg font-semibold">
                          {health.cacheStats.assets.total}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Assets
                          {health.cacheStats.assets.fresh > 0 && (
                            <span className="text-emerald-600">
                              {" "}({health.cacheStats.assets.fresh} fresh)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-lg font-semibold">
                          {health.cacheStats.contributors.total}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Contributors
                          {health.cacheStats.contributors.fresh > 0 && (
                            <span className="text-emerald-600">
                              {" "}({health.cacheStats.contributors.fresh} fresh)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      TTL: searches {health.cache.searchTtlHours}h · assets{" "}
                      {health.cache.assetTtlDays}d · contributors{" "}
                      {health.cache.contributorTtlDays}d
                    </p>
                  </div>

                  {/* Demo mode + Import status */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={health.demoModeAvailable ? "accent" : "secondary"}>
                      Demo mode: {health.demoModeAvailable ? "available" : "disabled"}
                    </Badge>
                    <Badge variant={health.manualImportAvailable ? "success" : "secondary"}>
                      Imported data: {health.manualImportAvailable ? "yes" : "none"}
                    </Badge>
                  </div>

                  {/* Cache refresh (owner only) */}
                  {isOwner && (
                    <div className="space-y-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCacheRefresh}
                        disabled={refreshing}
                        className="gap-1"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                        />
                        {refreshing ? "Refreshing…" : "Mark cache for refresh"}
                      </Button>
                      {refreshMsg && (
                        <p className="text-[11px] text-muted-foreground">
                          {refreshMsg}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Marks all cached entries as stale. Next searches will
                        fetch fresh data from Adobe Stock (if scraper is enabled).
                        Does not trigger aggressive scraping.
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {session?.user && (
          <Card>
            <CardHeader>
              <CardTitle>Active devices</CardTitle>
              <CardDescription>
                Manage where you&apos;re signed in. Limits follow your plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {devicesError ? (
                <p className="text-rose-700">{devicesError}</p>
              ) : devices ? (
                <>
                  <p>
                    <span className="font-medium">
                      {devices.activeCount}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium">{devices.limit}</span>{" "}
                    devices used
                    {devices.overLimit && (
                      <Badge variant="danger" className="ml-2">
                        Over limit
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Device-limit enforcement is a PR #16 foundation. We
                    track every sign-in so you can see and revoke devices
                    today; hard blocking ships in a later release.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
              <Button asChild variant="outline">
                <Link href="/auth/device-limit">Manage devices</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {session?.user && (
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Forgot your password? Request a reset link and we&apos;ll
                send it to your email.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/auth/forgot-password">Reset password</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {session?.user && (
          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={() => signOut({ callbackUrl: "/auth/login" })}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
