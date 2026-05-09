import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "blue" | "orange" | "teal" | "purple" | "navy" | "rose";
}

const tones: Record<NonNullable<StatCardProps["tone"]>, string> = {
  blue: "from-blue-500 to-cyan-500",
  orange: "from-orange-500 to-rose-500",
  teal: "from-teal-500 to-emerald-500",
  purple: "from-purple-500 to-fuchsia-500",
  navy: "from-navy to-indigo-600",
  rose: "from-rose-500 to-pink-500",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "blue",
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-navy">
            {value}
          </p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white",
            tones[tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
