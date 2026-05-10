"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Link2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 8MB hard cap on uploaded images. Real visual matching never happens
 * server-side (we only tokenize the filename), so this only prevents
 * the browser from rendering huge previews and exhausting memory.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_MIME_PREFIX = "image/";

export interface SimilarImageQuery {
  imageUrl?: string;
  imageFileName?: string;
  hint?: string;
}

interface SimilarImageSearchProps {
  /** Pre-populated URL value, used when the user clicks "Find similar"
   *  on a result card. */
  seedImageUrl?: string;
  loading?: boolean;
  onFindSimilar: (query: SimilarImageQuery) => void;
  onClear?: () => void;
  /** When true, the panel renders a "Clear results" affordance because
   *  there are similar-image results currently displayed downstream. */
  hasResults?: boolean;
}

type Mode = "upload" | "url";

/**
 * Search-by-image panel for /search. Provides:
 *
 *   - Upload + URL input modes (radio toggle)
 *   - Local-only image preview (we never POST the bytes; matching uses
 *     metadata tokens only, per PRD)
 *   - Optional textual hint to refine the metadata-similarity query
 *   - "Find similar" + "Clear image" actions
 *   - Inline error states: invalid URL, unsupported file type, file too
 *     large, no input
 */
export function SimilarImageSearch({
  seedImageUrl,
  loading,
  onFindSimilar,
  onClear,
  hasResults,
}: SimilarImageSearchProps) {
  const fileInputId = useId();
  const urlInputId = useId();
  const hintInputId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<Mode>(seedImageUrl ? "url" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(seedImageUrl ?? "");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasInput = useMemo(
    () => Boolean(file || imageUrl.trim() || hint.trim()),
    [file, imageUrl, hint],
  );

  const handleFile = useCallback((f: File | null) => {
    setError(null);
    if (!f) {
      setFile(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    if (!f.type.startsWith(ACCEPTED_MIME_PREFIX)) {
      setError(`Unsupported file type: ${f.type || "unknown"}. Pick an image (PNG, JPG, WebP, \u2026).`);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(
        `Image is too large (${(f.size / (1024 * 1024)).toFixed(1)} MB). Max 8 MB.`,
      );
      return;
    }
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }, []);

  const handleClear = useCallback(() => {
    setFile(null);
    setImageUrl("");
    setHint("");
    setError(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
    onClear?.();
  }, [onClear]);

  const handleSubmit = useCallback(() => {
    setError(null);
    const trimmedUrl = imageUrl.trim();
    const trimmedHint = hint.trim();

    if (mode === "url") {
      if (!trimmedUrl) {
        setError("Paste an image URL or switch to Upload.");
        return;
      }
      try {
        const u = new URL(trimmedUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          setError("Image URL must start with http:// or https://");
          return;
        }
      } catch {
        setError("That doesn't look like a valid URL.");
        return;
      }
      onFindSimilar({
        imageUrl: trimmedUrl,
        hint: trimmedHint || undefined,
      });
      return;
    }

    // upload mode
    if (!file && !trimmedHint) {
      setError("Pick an image to upload, or enter a hint to describe it.");
      return;
    }
    onFindSimilar({
      imageFileName: file?.name,
      hint: trimmedHint || undefined,
    });
  }, [mode, file, imageUrl, hint, onFindSimilar]);

  return (
    <div className="space-y-3 rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Search by image</p>
          <p className="text-xs text-muted-foreground">
            Upload a reference image or paste a URL. We rank assets by
            metadata similarity (title, keywords, categories) — not real
            visual AI matching.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium",
              mode === "upload"
                ? "bg-accent-blue text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium",
              mode === "url"
                ? "bg-accent-blue text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            URL
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div
          className={cn(
            "relative aspect-square w-full overflow-hidden rounded-xl border border-dashed border-border bg-muted/40",
            previewUrl || (mode === "url" && imageUrl)
              ? "border-solid border-border/60"
              : "",
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={file?.name ?? "Preview"}
              className="h-full w-full object-cover"
            />
          ) : mode === "url" && imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={() => {
                setError("Could not load that URL. Double-check the link is publicly reachable.");
              }}
            />
          ) : (
            <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
              <div>
                <ImageIcon className="mx-auto h-6 w-6 opacity-50" />
                <p className="mt-2">No image selected</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {mode === "upload" ? (
            <div>
              <label
                htmlFor={fileInputId}
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Image file
              </label>
              <input
                id={fileInputId}
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={loading}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium hover:file:bg-muted/80"
              />
              {file && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>
          ) : (
            <div>
              <label
                htmlFor={urlInputId}
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Image URL
              </label>
              <Input
                id={urlInputId}
                type="url"
                placeholder="https://example.com/path/to/image.jpg"
                value={imageUrl}
                disabled={loading}
                autoComplete="off"
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setError(null);
                }}
                className="mt-1"
              />
            </div>
          )}

          <div>
            <label
              htmlFor={hintInputId}
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Hint (optional)
            </label>
            <Input
              id={hintInputId}
              placeholder="Describe the image: e.g. business meeting laptop"
              value={hint}
              disabled={loading}
              autoComplete="off"
              onChange={(e) => setHint(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Used as extra tokens for the metadata-similarity ranking. Helps a lot when the URL/filename has no descriptive words.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={handleSubmit}
              disabled={loading || !hasInput}
            >
              <ImageIcon className="h-4 w-4" />
              {loading ? "Finding\u2026" : "Find similar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={loading || (!hasInput && !hasResults)}
            >
              <X className="h-4 w-4" />
              Clear image
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
