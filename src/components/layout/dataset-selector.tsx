"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Database,
  FlaskConical,
  Layers,
  Upload,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useActiveDataset } from "@/hooks/use-active-dataset";
import type { DatasetScope } from "@/lib/dataset-scope";

/**
 * The compact selector that lives in the top bar. Three item kinds:
 *
 *   1. "All imported datasets" — aggregate (only shown when the user has
 *      ≥1 imported dataset).
 *   2. One item per non-archived dataset, newest-first.
 *   3. "Using demo data" — explicit opt-in for the mock provider.
 *
 * Guests see a simple read-only "Demo data" chip; clicking it routes to
 * /auth/login so the feature funnels them toward signing in.
 *
 * We deliberately use a native <details> for the dropdown instead of a
 * radix popover — no extra runtime dep, keyboard-accessible out of the
 * box, and it closes on outside click via the label toggle + backdrop.
 */
export function DatasetSelector({ className }: { className?: string }) {
  const router = useRouter();
  const state = useActiveDataset();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const choose = useCallback(
    async (
      next:
        | { kind: "all" }
        | { kind: "demo" }
        | { kind: "specific"; datasetId: string },
    ) => {
      setPending(true);
      setErr(null);
      try {
        await state.update(next);
        setOpen(false);
        // Trigger server components + data-fetching pages to re-run.
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to update.");
      } finally {
        setPending(false);
      }
    },
    [router, state],
  );

  // Guest — no dataset to pick, nudge them to sign in.
  if (!state.loading && !state.signedIn) {
    return (
      <Button
        asChild
        variant="outline"
        size="sm"
        className={cn("gap-2", className)}
        title="Sign in to use your imported datasets"
      >
        <Link href="/auth/login">
          <FlaskConical className="h-3.5 w-3.5 text-amber-600" />
          <span className="hidden sm:inline">Using demo data</span>
          <span className="sm:hidden">Demo</span>
        </Link>
      </Button>
    );
  }

  const triggerLabel = describeScopeShort(state);
  const TriggerIcon = iconForScope(state.scope);

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={state.loading}
        className="gap-2"
      >
        <TriggerIcon className="h-3.5 w-3.5" />
        <span className="hidden max-w-[18ch] truncate sm:inline">
          {triggerLabel}
        </span>
        <span className="sm:hidden">Data</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </Button>

      {open ? (
        <>
          {/* Outside-click backdrop. z-index under the menu but above the
              rest of the page so a click anywhere closes us. */}
          <div
            className="fixed inset-0 z-30"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          >
            <div className="border-b border-border bg-muted/30 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Active data source
            </div>

            <ul className="max-h-80 overflow-y-auto">
              {/* "All imported datasets" — only meaningful when the user
                   has datasets. Otherwise we omit the item entirely to
                   keep the menu honest (we never let them pick an empty
                   aggregate). */}
              {state.hasAnyDatasets ? (
                <SelectorItem
                  active={state.scope.kind === "all"}
                  onClick={() => choose({ kind: "all" })}
                  disabled={pending}
                  icon={<Layers className="h-4 w-4" />}
                  label="All imported datasets"
                  sublabel={`${state.datasets.length} ${
                    state.datasets.length === 1 ? "dataset" : "datasets"
                  } · aggregated`}
                />
              ) : null}

              {state.datasets.map((d) => (
                <SelectorItem
                  key={d.id}
                  active={
                    state.scope.kind === "specific" &&
                    state.scope.datasetId === d.id
                  }
                  onClick={() =>
                    choose({ kind: "specific", datasetId: d.id })
                  }
                  disabled={pending}
                  icon={<Database className="h-4 w-4" />}
                  label={d.name}
                  sublabel={`${formatNumber(d.rowCount)} ${
                    d.rowCount === 1 ? "row" : "rows"
                  }`}
                />
              ))}

              <SelectorItem
                active={state.scope.kind === "demo"}
                onClick={() => choose({ kind: "demo" })}
                disabled={pending}
                icon={<FlaskConical className="h-4 w-4 text-amber-600" />}
                label="Using demo data"
                sublabel="Mock provider · no real metrics"
                divider={state.hasAnyDatasets}
              />
            </ul>

            <div className="border-t border-border bg-muted/30 px-3 py-2">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setOpen(false)}
              >
                <Link href="/import">
                  <Upload className="h-3.5 w-3.5" />
                  {state.hasAnyDatasets
                    ? "Manage datasets"
                    : "Import your first CSV"}
                </Link>
              </Button>
            </div>

            {err ? (
              <div className="border-t border-border bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {err}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface ItemProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  divider?: boolean;
}

function SelectorItem({
  active,
  onClick,
  disabled,
  icon,
  label,
  sublabel,
  divider,
}: ItemProps) {
  return (
    <li className={divider ? "border-t border-border" : undefined}>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60",
          "disabled:cursor-not-allowed disabled:opacity-60",
          active && "bg-accent-blue/5",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md border border-border bg-background",
            active && "border-accent-blue/40 bg-accent-blue/10 text-accent-blue",
          )}
          aria-hidden
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{label}</span>
          {sublabel ? (
            <span className="block truncate text-[11px] text-muted-foreground">
              {sublabel}
            </span>
          ) : null}
        </span>
        {active ? (
          <Check className="h-4 w-4 flex-none text-accent-blue" aria-hidden />
        ) : null}
      </button>
    </li>
  );
}

function iconForScope(scope: DatasetScope) {
  if (scope.kind === "demo") return FlaskConical;
  if (scope.kind === "specific") return Database;
  return Layers;
}

function describeScopeShort(state: {
  scope: DatasetScope;
  datasetName: string | null;
  hasAnyDatasets: boolean;
}): string {
  if (state.scope.kind === "demo") return "Demo data";
  if (state.scope.kind === "specific") {
    return state.datasetName ?? "Selected dataset";
  }
  return state.hasAnyDatasets
    ? "All imported datasets"
    : "No imported data yet";
}
