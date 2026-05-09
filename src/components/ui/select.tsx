"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Lightweight native-select wrapper. Real shadcn/ui radix-based select can be
// dropped in later; this keeps the MVP simple, accessible, and SSR-friendly.

export interface SimpleSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: ReadonlyArray<{ value: string; label: string }>;
}

const SimpleSelect = React.forwardRef<HTMLSelectElement, SimpleSelectProps>(
  ({ options, className, ...props }, ref) => (
    <div className={cn("relative", className)}>
      <select
        ref={ref}
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
SimpleSelect.displayName = "SimpleSelect";

export { SimpleSelect };
