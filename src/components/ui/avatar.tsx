import * as React from "react";
import { cn } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  fallback: string;
}

export function Avatar({ src, alt, fallback, className, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        "relative inline-flex h-10 w-10 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-accent-blue/15 text-sm font-semibold text-accent-blue",
        className,
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? fallback} className="h-full w-full object-cover" />
      ) : (
        <span>{fallback.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}
