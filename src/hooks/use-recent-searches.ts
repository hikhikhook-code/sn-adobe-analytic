"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "sn-recent-searches";
const MAX = 8;

export function useRecentSearches() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const add = useCallback(
    (kw: string) => {
      const cleaned = kw.trim();
      if (!cleaned) return;
      const next = [cleaned, ...items.filter((i) => i.toLowerCase() !== cleaned.toLowerCase())].slice(0, MAX);
      persist(next);
    },
    [items, persist],
  );

  const remove = useCallback(
    (kw: string) => {
      persist(items.filter((i) => i !== kw));
    },
    [items, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { items, add, remove, clear };
}
