"use client";

import { X } from "lucide-react";

interface RecentSearchesProps {
  items: string[];
  onPick: (kw: string) => void;
  onRemove: (kw: string) => void;
  onClear: () => void;
}

export function RecentSearches({ items, onPick, onRemove, onClear }: RecentSearchesProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recent
      </p>
      {items.map((it) => (
        <span
          key={it}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs text-foreground"
        >
          <button
            type="button"
            onClick={() => onPick(it)}
            className="hover:underline"
          >
            {it}
          </button>
          <button
            type="button"
            aria-label={`Remove ${it}`}
            onClick={() => onRemove(it)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
