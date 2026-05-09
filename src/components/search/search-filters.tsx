"use client";

import {
  AI_FILTER_OPTIONS,
  CONTENT_TYPE_OPTIONS,
  SORT_OPTIONS,
} from "@/lib/constants";
import { SimpleSelect } from "@/components/ui/select";
import type { AiFilter, ContentType, SortMode } from "@/types/search";

interface SearchFiltersProps {
  sort: SortMode;
  contentType: ContentType;
  aiFilter: AiFilter;
  onChange: (
    next: Partial<{ sort: SortMode; contentType: ContentType; aiFilter: AiFilter }>,
  ) => void;
}

export function SearchFilters({
  sort,
  contentType,
  aiFilter,
  onChange,
}: SearchFiltersProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <FilterField label="Sort by">
        <SimpleSelect
          value={sort}
          onChange={(e) => onChange({ sort: e.target.value as SortMode })}
          options={SORT_OPTIONS as unknown as Array<{ value: string; label: string }>}
        />
      </FilterField>
      <FilterField label="Content type">
        <SimpleSelect
          value={contentType}
          onChange={(e) => onChange({ contentType: e.target.value as ContentType })}
          options={CONTENT_TYPE_OPTIONS as unknown as Array<{ value: string; label: string }>}
        />
      </FilterField>
      <FilterField label="Generative AI">
        <SimpleSelect
          value={aiFilter}
          onChange={(e) => onChange({ aiFilter: e.target.value as AiFilter })}
          options={AI_FILTER_OPTIONS as unknown as Array<{ value: string; label: string }>}
        />
      </FilterField>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
