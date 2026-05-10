"use client";

import Link from "next/link";
import {
  FileDown,
  Search,
  Sparkles,
  TrendingUp,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Dashboard Quick Actions — five buttons wired to real pages.
 *
 * Every action routes to a page that exists in the app (search, import,
 * portfolio, trending, export). Per the PRD brief, no fake buttons.
 */
export function QuickActionsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-blue" />
          Quick actions
        </CardTitle>
        <CardDescription>Jump straight into the main workflows.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ActionButton href="/search" icon={Search} label="New search" primary />
        <ActionButton href="/import" icon={Upload} label="Import data" />
        <ActionButton href="/portfolio" icon={Users} label="Track contributor" />
        <ActionButton href="/trending" icon={TrendingUp} label="View trending" />
        <ActionButton href="/export" icon={FileDown} label="Export latest results" />
      </CardContent>
    </Card>
  );
}

function ActionButton({
  href,
  icon: Icon,
  label,
  primary,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  primary?: boolean;
}) {
  return (
    <Button
      asChild
      variant={primary ? "accent" : "outline"}
      className="justify-start"
    >
      <Link href={href}>
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}
