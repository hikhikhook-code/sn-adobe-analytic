"use client";

import { useState } from "react";
import { Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CollectionRecord } from "@/hooks/use-collections";

/**
 * Active collection filter surfaced to the /saved page. `"all"` shows
 * everything; `"uncategorized"` shows items not assigned to any folder;
 * a concrete id shows that folder's contents.
 */
export type CollectionFilter = "all" | "uncategorized" | { id: string };

interface CollectionSidebarProps {
  collections: CollectionRecord[];
  loaded: boolean;
  filter: CollectionFilter;
  /** Total favorites + saved searches, used for the "All" row count. */
  totalAll: number;
  /** Items currently assigned to no collection. */
  totalUncategorized: number;
  onFilterChange: (filter: CollectionFilter) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Left-rail collection manager. Single source of truth for both
 * filtering and editing — the parent page owns no collection state
 * beyond the active filter selection.
 */
export function CollectionSidebar({
  collections,
  loaded,
  filter,
  totalAll,
  totalUncategorized,
  onFilterChange,
  onCreate,
  onRename,
  onDelete,
}: CollectionSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filterKey =
    filter === "all"
      ? "all"
      : filter === "uncategorized"
        ? "uncategorized"
        : filter.id;

  const isActive = (key: string) => filterKey === key;

  const activate = (next: CollectionFilter) => () => onFilterChange(next);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setCreateError(null);
    try {
      await onCreate(name);
      setNewName("");
      setCreating(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="space-y-2">
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Collections
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Create collection"
            className="h-7 w-7"
            onClick={() => {
              setCreating((v) => !v);
              setCreateError(null);
            }}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>

        {creating ? (
          <div className="mb-2 space-y-1">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Travel"
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="accent"
                onClick={submitCreate}
                disabled={busy || newName.trim().length === 0}
              >
                Create
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
            {createError ? (
              <p className="text-[11px] text-rose-700">{createError}</p>
            ) : null}
          </div>
        ) : null}

        <ul className="space-y-0.5">
          <SidebarRow
            active={isActive("all")}
            onClick={activate("all")}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="All saved"
            count={totalAll}
          />
          <SidebarRow
            active={isActive("uncategorized")}
            onClick={activate("uncategorized")}
            icon={<Folder className="h-3.5 w-3.5" />}
            label="Uncategorized"
            count={totalUncategorized}
          />
          {!loaded ? (
            <li className="py-2 text-[11px] text-muted-foreground">Loading…</li>
          ) : collections.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-muted-foreground">
              No custom folders yet.
            </li>
          ) : (
            collections.map((c) => (
              <EditableRow
                key={c.id}
                collection={c}
                active={isActive(c.id)}
                onSelect={activate({ id: c.id })}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))
          )}
        </ul>
      </div>
    </aside>
  );
}

function SidebarRow({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          active
            ? "bg-accent-blue/10 font-semibold text-accent-blue"
            : "text-foreground hover:bg-muted/60",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </button>
    </li>
  );
}

function EditableRow({
  collection,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  collection: CollectionRecord;
  active: boolean;
  onSelect: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(collection.name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = value.trim();
    if (!next || next === collection.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onRename(collection.id, next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-1 px-1 py-1">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") {
              setEditing(false);
              setValue(collection.name);
            }
          }}
          maxLength={80}
        />
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="accent" onClick={submit} disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue(collection.name);
            }}
          >
            Cancel
          </Button>
        </div>
        {err ? <p className="text-[11px] text-rose-700">{err}</p> : null}
      </li>
    );
  }

  const total = collection.favoriteCount + collection.searchCount;
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          active
            ? "bg-accent-blue/10 font-semibold text-accent-blue"
            : "text-foreground hover:bg-muted/60",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Folder className="h-3.5 w-3.5" />
          <span className="truncate">{collection.name}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">{total}</span>
      </button>
      <div className="invisible absolute right-8 top-1/2 -translate-y-1/2 gap-0.5 group-hover:visible group-focus-within:visible flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          aria-label={`Rename ${collection.name}`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-rose-600"
          onClick={(e) => {
            e.stopPropagation();
            if (
              confirm(
                `Delete collection "${collection.name}"? Items in it will move back to Uncategorized.`,
              )
            ) {
              void onDelete(collection.id);
            }
          }}
          aria-label={`Delete ${collection.name}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </li>
  );
}
