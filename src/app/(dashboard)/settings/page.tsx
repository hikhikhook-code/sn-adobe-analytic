"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { ShieldCheck } from "lucide-react";
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
