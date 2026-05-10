import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface UnavailableCardStateProps {
  /**
   * One-line reason, e.g. "Verified downloads are unavailable from this
   * public-metadata source." Prefer the provider-emitted `notice` when
   * one is present; fall back to a generic message otherwise.
   */
  message: string;
  className?: string;
}

/**
 * Shared "provider cannot supply this metric" state for dashboard cards
 * and widgets. Never renders fake zeros — the PRD's hard rule against
 * fabricated Adobe download numbers means widgets must render this when
 * their `*Available` flag on `ProviderDashboardResult` is `false`.
 */
export function UnavailableCardState({
  message,
  className,
}: UnavailableCardStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold uppercase tracking-wide">
          Unavailable
        </span>{" "}
        <span className="text-amber-900/80">{message}</span>
      </span>
    </div>
  );
}
