"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
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

interface DeviceUsageResponse {
  plan: string;
  limit: number;
  activeCount: number;
  overLimit: boolean;
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [devices, setDevices] = useState<DeviceUsageResponse | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, [status]);

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
                  <Badge variant="secondary" className="mt-1">
                    {devices?.plan ?? "Free"}
                  </Badge>
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
                      <Badge variant="destructive" className="ml-2">
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
