"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Database,
  FlaskConical,
  Layers,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";
import type { DataQuality } from "@/types/search";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";

/**
 * Page-level "what data powers this view" banner.
 *
 * One banner, four visual states, all derived from the resolved scope
 * information the API echoes back:
 *
 *   "Using all imported datasets"  — scope=all, user has ≥1 dataset
 *   "Using dataset: <name>"        — scope=specific
 *   "Using demo data"              — scope=demo AND user has datasets
 *                                    (explicit opt-in to mock)
 *   "No imported data yet"         — scope=demo AND user has no datasets
 *                                    (also gets a CTA to import)
 *
 * Orphaned-fallback (selected dataset was archived/deleted mid-session) is
 * rendered as a warning variant on top of the "all datasets" state, so the
 * user learns why the numbers changed without needing to visit /import.
 */

export type ScopeReason = DatasetScopeInfo["reason"];

export interface DataSourceBannerProps {
  scope: DatasetScope;
  /** Resolved name when scope.kind === "specific". */
  datasetName?: string | null;
  /** Whether the user has ≥1 non-archived dataset. */
  hasAnyDatasets?: boolean;
  /** From resolveDatasetScope / API echo. Drives the warning variant. */
  reason?: ScopeReason;
  /** Provider-emitted quality (demo / verified / etc). */
  dataQuality?: DataQuality;
  /** Optional concrete provider label ("User imported data", etc). */
  providerName?: string;
  className?: string;
}

export function DataSourceBanner({
  scope,
  datasetName,
  hasAnyDatasets,
  reason,
  dataQuality,
  providerName,
  className,
}: DataSourceBannerProps) {
  const state = deriveState({ scope, datasetName, hasAnyDatasets, reason });

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        state.containerClass,
        className,
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 flex-none place-items-center rounded-lg border",
          state.iconBoxClass,
        )}
        aria-hidden
      >
        <state.Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          <span>{state.title}</span>
          {dataQuality ? (
            <DataQualityBadge level={dataQuality} size="xs" />
          ) : null}
          {providerName ? (
            <span className="text-[11px] font-normal text-current/80">
              · {providerName}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-current/80">
          {state.description}
        </div>
      </div>

      {state.cta ? (
        <Button asChild variant={state.ctaVariant} size="sm" className="flex-none">
          <Link href={state.cta.href}>{state.cta.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

interface DerivedState {
  title: string;
  description: string;
  Icon: React.ElementType;
  containerClass: string;
  iconBoxClass: string;
  cta?: { href: string; label: string };
  ctaVariant?: "accent" | "outline";
}

function deriveState({
  scope,
  datasetName,
  hasAnyDatasets,
  reason,
}: {
  scope: DatasetScope;
  datasetName?: string | null;
  hasAnyDatasets?: boolean;
  reason?: ScopeReason;
}): DerivedState {
  // Warning variant when the user's selected dataset is gone.
  if (reason === "orphaned_fallback_all") {
    return {
      title: "Your selected dataset is no longer available",
      description:
        "It was archived or deleted. We're showing all your imported datasets instead — change the selection in the top bar if you'd like.",
      Icon: AlertTriangle,
      containerClass: "border-amber-200 bg-amber-50 text-amber-900",
      iconBoxClass: "border-amber-300 bg-amber-100 text-amber-700",
      cta: { href: "/import", label: "Manage datasets" },
      ctaVariant: "outline",
    };
  }

  if (scope.kind === "specific") {
    return {
      title: `Using dataset: ${datasetName ?? "(unnamed)"}`,
      description:
        "Every analytics surface below is scoped to this single dataset.",
      Icon: Database,
      containerClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
      iconBoxClass: "border-emerald-300 bg-emerald-100 text-emerald-700",
    };
  }

  if (scope.kind === "all") {
    if (!hasAnyDatasets) {
      // Defensive — resolveDatasetScope turns "all + 0 datasets" into
      // reason=no_datasets + scope=all. We still handle the case here so
      // a stale client state never shows "Using all imported datasets"
      // when there are none.
      return noImportsState();
    }
    return {
      title: "Using all imported datasets",
      description:
        "Analytics aggregate across every dataset you've imported. Pick a single dataset from the top-bar selector to narrow down.",
      Icon: Layers,
      containerClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
      iconBoxClass: "border-emerald-300 bg-emerald-100 text-emerald-700",
    };
  }

  // scope.kind === "demo"
  if (!hasAnyDatasets || reason === "guest" || reason === "no_datasets") {
    return noImportsState();
  }
  return {
    title: "Using demo data",
    description:
      "Synthetic metrics generated by SN Adobe Analytic. They don't reflect real Adobe Stock data. Switch back to your imported datasets from the top-bar selector.",
    Icon: FlaskConical,
    containerClass: "border-amber-200 bg-amber-50 text-amber-900",
    iconBoxClass: "border-amber-300 bg-amber-100 text-amber-700",
  };
}

function noImportsState(): DerivedState {
  return {
    title: "No imported data yet",
    description:
      "Showing mock / demo metrics so you can explore the app. Import a CSV of your own analytics to switch every page to your verified numbers.",
    Icon: FlaskConical,
    containerClass: "border-amber-200 bg-amber-50 text-amber-900",
    iconBoxClass: "border-amber-300 bg-amber-100 text-amber-700",
    cta: { href: "/import", label: "Import your CSV" },
    ctaVariant: "accent",
  };
}
