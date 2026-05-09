"use client";

import { useSession, signOut } from "next-auth/react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const { data: session, status } = useSession();

  return (
    <>
      <TopBar title="Settings" subtitle="Manage your account" />
      <div className="space-y-6 p-6">
        <PageHeader title="Account" description="Profile, plan, and danger zone." />

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
                  <Badge variant="secondary" className="mt-1">Free</Badge>
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
