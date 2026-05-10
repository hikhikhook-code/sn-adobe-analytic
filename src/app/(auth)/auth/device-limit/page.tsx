"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

/**
 * /auth/device-limit
 *
 * Foundation page that surfaces the user's plan, their device limit
 * (per PRD §6), the devices we've recorded, and a soft "revoke" control
 * per device. This PR does NOT hard-block sign-ins on the limit — see
 * `deviceLimitForPlan` for the rationale. When a user is over their
 * plan's cap we render an amber warning banner explaining that we'll
 * start enforcing the cap in a later release and pointing at a future
 * "Upgrade plan" link (Settings for now).
 */
interface DeviceRow {
  id: string;
  deviceName: string;
  deviceId: string;
  userAgent: string | null;
  ipHint: string | null;
  lastActive: string;
  firstSeen: string;
  isActive: boolean;
}

interface DeviceUsageResponse {
  plan: string;
  limit: number;
  activeCount: number;
  overLimit: boolean;
  devices: DeviceRow[];
}

export default function DeviceLimitPage() {
  const [data, setData] = useState<DeviceUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (res.status === 401) {
        setError("Sign in to view your device usage.");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j: DeviceUsageResponse = await res.json();
      setData(j);
    } catch {
      setError("Couldn't load your device list. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await fetch(`/api/devices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Active devices</CardTitle>
        <CardDescription>
          Manage the devices signed in to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading && (
          <p className="text-center text-muted-foreground">Loading…</p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-md bg-rose-50 px-3 py-2 text-rose-700"
          >
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current plan
                </p>
                <p className="font-medium">{data.plan}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Devices
                </p>
                <p className="font-medium">
                  {data.activeCount} / {data.limit}
                </p>
              </div>
            </div>

            {data.overLimit && (
              <div
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <p className="font-semibold">
                  You&apos;re signed in on more devices than your plan
                  allows.
                </p>
                <p className="mt-1">
                  We&apos;re not enforcing this limit yet — a future
                  release will start requiring you to sign one out before
                  signing in elsewhere. You can revoke extra devices
                  below, or upgrade your plan.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/settings">Upgrade plan</Link>
                  </Button>
                </div>
              </div>
            )}

            {data.devices.length === 0 ? (
              <p className="text-center text-muted-foreground">
                No devices recorded yet. Sign in from another browser to
                see it listed here.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.devices.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-md border border-border/60 bg-card px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">
                            {d.deviceName}
                          </p>
                          {d.isActive ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Revoked
                            </Badge>
                          )}
                        </div>
                        {d.userAgent && (
                          <p
                            className="mt-0.5 truncate text-[11px] text-muted-foreground"
                            title={d.userAgent}
                          >
                            {d.userAgent}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Last active {timeAgo(d.lastActive)} · First seen{" "}
                          {timeAgo(d.firstSeen)}
                        </p>
                      </div>
                      {d.isActive && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={revokingId === d.id}
                          onClick={() => revoke(d.id)}
                        >
                          {revokingId === d.id ? "Revoking…" : "Revoke"}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap justify-center gap-2 border-t border-border/40 pt-3 text-center">
              <Button asChild variant="secondary">
                <Link href="/dashboard">Back to dashboard</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => signOut({ callbackUrl: "/auth/login" })}
              >
                Sign out this browser
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
