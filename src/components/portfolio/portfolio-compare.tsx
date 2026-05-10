"use client";

import { useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface PortfolioCompareProps {
  /** Pre-filled "contributor A" so the user doesn't retype the one they're already viewing. */
  primaryContributor?: string;
}

/**
 * Compare-contributors UI foundation. Per PRD scope item 8 we render a
 * working A/B input + button, but flag the feature as Coming Soon: side-by-
 * side metric comparison hasn't been wired into the provider yet, and we
 * don't want the user to think the comparison is real.
 */
export function PortfolioCompare({ primaryContributor }: PortfolioCompareProps) {
  const [a, setA] = useState(primaryContributor ?? "");
  const [b, setB] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Compare contributors</CardTitle>
          <CardDescription>
            Side-by-side analytics for two contributors
          </CardDescription>
        </div>
        <Badge variant="secondary" className="font-medium">
          Coming Soon
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
          <Field label="Contributor A" value={a} onChange={setA} />
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
          <Field label="Contributor B" value={b} onChange={setB} />
          <Button
            variant="outline"
            size="sm"
            disabled={!a.trim() || !b.trim()}
            onClick={() => setSubmitted(true)}
          >
            Compare
          </Button>
        </div>
        {submitted ? (
          <div
            role="status"
            className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900"
          >
            <p className="font-semibold uppercase tracking-wide">
              Coming Soon · Comparison view
            </p>
            <p className="mt-0.5 text-[12px] leading-snug">
              Multi-contributor side-by-side analytics will land in a future
              PR. For now, look up each contributor individually using the
              search bar above.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            We&apos;ll show overview, best sellers, content mix, and keyword
            overlap once this view ships.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Contributor name or URL"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
        />
      </div>
    </div>
  );
}
