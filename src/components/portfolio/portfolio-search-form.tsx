"use client";

import { Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PortfolioSearchFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

/**
 * Portfolio search input. Accepts contributor name, numeric ID, or a
 * stock.adobe.com/contributor URL — see `parseContributorInput` for the
 * recognized shapes.
 */
export function PortfolioSearchForm({
  query,
  onQueryChange,
  onSubmit,
  loading,
}: PortfolioSearchFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onSubmit();
      }}
      className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:flex-row"
    >
      <div className="relative flex-1">
        <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Contributor name, numeric ID, or stock.adobe.com/contributor URL"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="pl-10"
          aria-label="Contributor search"
        />
      </div>
      <Button type="submit" variant="accent" disabled={loading || !query.trim()}>
        <Search className="h-4 w-4" />
        {loading ? "Analyzing..." : "Analyze"}
      </Button>
    </form>
  );
}
