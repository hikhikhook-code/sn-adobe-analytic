import { competitionLabel, competitionColor } from "@/lib/scoring";
import { formatNumber, cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface ResultsSummaryProps {
  totalResults: number;
  keyword: string;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
}

export function ResultsSummary({
  totalResults,
  keyword,
  competitionLevel,
  aiSaturation,
  contentBreakdown,
}: ResultsSummaryProps) {
  const totalShown = contentBreakdown.reduce((s, c) => s + c.count, 0) || 1;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Total results
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            {formatNumber(totalResults)}
          </p>
          <p className="text-xs text-muted-foreground">
            for &quot;{keyword}&quot;
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Competition
          </p>
          <p
            className={cn(
              "mt-1 text-xl font-semibold tracking-tight capitalize",
              competitionColor(competitionLevel),
            )}
          >
            {competitionLevel}
          </p>
          <p className="text-xs text-muted-foreground">
            {competitionLabel(competitionLevel)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> AI saturation
            </span>
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            {aiSaturation}%
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-accent-purple"
              style={{ width: `${aiSaturation}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Content breakdown
          </p>
          <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {contentBreakdown.map((b, i) => {
              const colors = ["bg-accent-blue", "bg-accent-orange", "bg-accent-teal", "bg-accent-purple"];
              return (
                <div
                  key={b.type}
                  className={colors[i % colors.length]}
                  style={{ width: `${(b.count / totalShown) * 100}%` }}
                  title={`${b.type}: ${b.count}`}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] capitalize text-muted-foreground">
            {contentBreakdown.map((b) => (
              <span key={b.type}>
                {b.type} {b.count}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
