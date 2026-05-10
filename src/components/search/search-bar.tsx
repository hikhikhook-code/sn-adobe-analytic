"use client";

import { Search, Image as ImageIcon, Heart } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  onSubmit: (keyword: string) => void;
  loading?: boolean;
  /** When provided, the "By image" button is enabled and toggles the
   *  Similar Image Search panel on /search. Highlighted while open. */
  onToggleByImage?: () => void;
  byImageActive?: boolean;
}

export function SearchBar({
  defaultValue,
  onSubmit,
  loading,
  onToggleByImage,
  byImageActive,
}: SearchBarProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const q = String(fd.get("q") ?? "").trim();
        if (q) onSubmit(q);
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={defaultValue}
          placeholder="Search keyword (e.g. business, nature, ai illustration)"
          className="h-12 pl-10 text-base"
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="lg" variant="accent" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant={byImageActive ? "accent" : "outline"}
          onClick={onToggleByImage}
          disabled={!onToggleByImage}
          aria-pressed={byImageActive ?? undefined}
          title={
            onToggleByImage
              ? "Toggle the Similar Image Search panel"
              : "Search by image is unavailable on this page"
          }
          className={cn(byImageActive && "shadow-sm")}
        >
          <ImageIcon className="h-4 w-4" />
          By image
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/saved">
            <Heart className="h-4 w-4" />
            Saved
          </Link>
        </Button>
      </div>
    </form>
  );
}
