/**
 * In-memory idempotency guard for /api/search.
 *
 * ## Why this exists
 * PR #20 fixed the client-side search duplication by funneling every
 * trigger through a single `runSearch` + `lastSignatureRef` guard and
 * by dropping the old URL-driven `useEffect`. That made the happy path
 * deterministic, but didn't defend against two remaining sources of
 * double-inserts that QA caught after the PR shipped:
 *
 *   1. **React Strict Mode remount (dev + occasional production HMR).**
 *      React 18 deliberately mounts → unmounts → remounts each component
 *      once in dev. The page-level `lastSignatureRef` and `didMountRef`
 *      are recreated on the second mount, so the initial-URL search
 *      effect re-fires and the server sees a second POST for the same
 *      query. The first POST had already completed the
 *      `SearchHistory.create` + `recordDailySearch` before the client
 *      aborted, so aborting the second request doesn't help — the
 *      history row and counter increment had already landed.
 *
 *   2. **Refresh / back-forward navigation to /search?q=<keyword>.**
 *      Both reload the page, which runs the initial-URL effect fresh.
 *      Brief explicitly calls this out: "refreshing /search should not
 *      insert another row." A pure client-side dedup can never see
 *      across reloads — the guard is in a fresh memory space.
 *
 * ## What it does
 * Given an idempotency key (see `searchDedupKey` below), the `seenRecently`
 * helper returns `true` on subsequent calls within a short TTL window
 * and `false` on the first call. Callers use that to decide whether to
 * write a `SearchHistory` row and tick the daily-search counter — the
 * search itself still runs and returns fresh results, we just skip the
 * user-visible side effects for the duplicate.
 *
 * ## Scope
 * Process-local Map. That's enough to fix the bug: both Strict-Mode
 * remount and fast refresh produce duplicate POSTs to the same server
 * process within milliseconds. If this app ever scales to multiple
 * concurrent Node processes behind a load balancer, we'd need a
 * Redis-backed dedup — but that's PR #24+ infra work, not this PR's
 * scope (and the PRD caps concurrent workload well below that).
 *
 * Nothing about the dedup cache is a capability grant: the worst case
 * if a user somehow collides on a key they don't own is that ONE of
 * their legitimate searches doesn't record history or count toward
 * their daily budget. No data leaks, no cross-user contamination.
 */

/**
 * TTL for a single dedup entry. Chosen to comfortably cover React
 * Strict Mode's remount cycle (sub-millisecond) and typical refresh /
 * back-forward windows (seconds), while being short enough that a
 * deliberate re-run of the same search 30 seconds later DOES count
 * as a new search — which matches the user's intent.
 */
const DEDUP_TTL_MS = 30_000;

/**
 * Upper bound on in-memory entries. A malicious or buggy client
 * could otherwise OOM the process by firing unique keys forever.
 * 5k is well above any realistic burst; pruning on each call keeps
 * this cheap.
 */
const MAX_ENTRIES = 5_000;

const cache = new Map<string, number>();

/**
 * Build the deterministic dedup key for a search request.
 *
 * Shape: `<userOrAnon>\0<kw>\0<sort>\0<ct>\0<ai>\0<page>\0<bucket>`
 *
 * Using a time bucket (30s window) rather than a rolling TTL means two
 * identical requests issued across adjacent buckets can each record.
 * We pick floor(now / 30s) so the window boundaries are predictable;
 * combined with the 30s TTL on the cache entry this gives a clean
 * "same request within the same 30s window = one record" semantics
 * that's easy to reason about and matches the brief (refresh =
 * same window = no double insert).
 *
 * We namespace by user so two different users running the same
 * keyword in the same instant each get counted — never skip a user's
 * real search because of a coincident request from someone else.
 *
 * Anonymous callers always get `anon` — /api/search already skips
 * SearchHistory + counter for unauthenticated users, so the dedup
 * decision doesn't actually matter for them, but the key still needs
 * to be well-formed.
 */
export function searchDedupKey(args: {
  userId: string | null | undefined;
  keyword: string;
  sort: string;
  contentType: string;
  aiFilter: string;
  page: number;
  now?: number;
}): string {
  const bucket = Math.floor((args.now ?? Date.now()) / DEDUP_TTL_MS);
  const kw = args.keyword.trim().toLowerCase();
  return [
    args.userId ?? "anon",
    kw,
    args.sort,
    args.contentType,
    args.aiFilter,
    args.page,
    bucket,
  ].join("\0");
}

/**
 * Returns `true` if a matching request was seen within the TTL window.
 * On a miss, records the key atomically so concurrent calls see it.
 *
 * Prunes expired entries on every call to keep the cache bounded even
 * when no new dedup key is seen for a while.
 */
export function seenRecently(key: string, now: number = Date.now()): boolean {
  // Prune expired entries. We iterate the whole map (no early break)
  // because re-setting an existing key does NOT change its insertion
  // order in JS Maps — so a fresh entry written AFTER an older,
  // now-expired entry still sits earlier in iteration order. Breaking
  // on the first non-expired entry would strand that older, expired
  // one. The cache is capped at MAX_ENTRIES so this stays O(cap).
  const cutoff = now - DEDUP_TTL_MS;
  for (const [k, ts] of cache) {
    if (ts < cutoff) {
      cache.delete(k);
    }
  }
  if (cache.size > MAX_ENTRIES) {
    const excess = cache.size - MAX_ENTRIES;
    let i = 0;
    for (const k of cache.keys()) {
      if (i >= excess) break;
      cache.delete(k);
      i += 1;
    }
  }

  const existing = cache.get(key);
  if (existing != null && existing >= cutoff) {
    return true;
  }
  cache.set(key, now);
  return false;
}

/**
 * Test-only helper: wipe the in-memory cache between unit tests so a
 * hit in one test doesn't leak into the next. Exported under a
 * deliberately ugly name so it's obvious at call sites.
 */
export function __resetSearchDedupForTests(): void {
  cache.clear();
}
