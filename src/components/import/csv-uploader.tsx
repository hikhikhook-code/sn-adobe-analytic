"use client";

import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CsvUploaderProps {
  /** Name of the currently-selected file, or null if none. */
  fileName: string | null;
  /** Size of the currently-selected file, in bytes. 0 when none. */
  fileSizeBytes: number;
  /** True while we're parsing the CSV for preview. */
  busy?: boolean;
  /** True while we're submitting an import. */
  disabled?: boolean;
  /** Called with the first selected / dropped file. */
  onFile: (file: File) => void | Promise<void>;
}

/**
 * Drag-and-drop + click-to-select CSV uploader.
 *
 * The whole card is a drop target (with `onDragOver`, `onDragEnter`,
 * `onDragLeave`, `onDrop`) and is also clickable / keyboard-activatable so
 * the user never has to hunt for the small "Choose file" button.
 */
export function CsvUploader({
  fileName,
  fileSizeBytes,
  busy = false,
  disabled = false,
  onFile,
}: CsvUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = useCallback(() => {
    if (disabled || busy) return;
    inputRef.current?.click();
  }, [busy, disabled]);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      e.preventDefault();
      e.stopPropagation();
      // Show the copy cursor so users know they can drop here.
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
    },
    [busy, disabled, dragOver],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    },
    [busy, disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      // Only reset when the cursor actually leaves the outer element — not
      // when it moves over a child (which would otherwise flicker).
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    },
    [busy, disabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void onFile(files[0]);
      }
    },
    [busy, disabled, onFile],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    },
    [busy, disabled, openPicker],
  );

  return (
    <div
      role="button"
      tabIndex={disabled || busy ? -1 : 0}
      aria-label="Upload CSV file"
      aria-disabled={disabled || busy}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        dragOver
          ? "border-accent-blue bg-accent-blue/10"
          : "border-border bg-muted/30 hover:border-accent-blue/60 hover:bg-muted/50",
        (disabled || busy) && "pointer-events-none cursor-not-allowed opacity-60",
      )}
    >
      <div
        className={cn(
          "grid h-12 w-12 place-items-center rounded-full border transition-colors",
          dragOver
            ? "border-accent-blue/40 bg-accent-blue/20 text-accent-blue"
            : "border-border bg-card text-muted-foreground group-hover:text-accent-blue",
        )}
        aria-hidden
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : fileName ? (
          <FileUp className="h-5 w-5" />
        ) : (
          <Upload className="h-5 w-5" />
        )}
      </div>

      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {fileName ?? "Drag & drop your CSV here"}
        </p>
        <p className="text-xs text-muted-foreground">
          {fileName
            ? `${(fileSizeBytes / 1024).toFixed(1)} KB — click to choose another file`
            : "or click anywhere in this box to choose a file (max 10MB, .csv)"}
        </p>
      </div>

      <Button
        type="button"
        variant="accent"
        size="sm"
        disabled={disabled || busy}
        onClick={(e) => {
          // The outer div already opens the picker; stop the click from
          // reaching it so we don't open the file dialog twice.
          e.stopPropagation();
          openPicker();
        }}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
          </>
        ) : (
          <>Choose file</>
        )}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          // Reset so the same file can be re-selected after an error.
          e.target.value = "";
        }}
      />
    </div>
  );
}
