# PRD alignment status

This document maps every feature in the SN Adobe Analytic PRD to its current
implementation state in the repo, and explains the data-source strategy
that keeps download/performance numbers honest.

> **Source of truth:** `SN-Adobe-Analytic-PRD.md`. If this doc and the PRD
> ever disagree, the PRD wins — file an issue.

---

## 1. Provider architecture

The app reads from one of three pluggable providers, selected by the
`DATA_PROVIDER` environment variable:

| `DATA_PROVIDER` | Module | Data quality | Notes |
| --- | --- | --- | --- |
| `mock` | `src/lib/providers/mock.ts` | `Demo Data` | Default. Synthetic numbers for showcase. |
| `manual` | `src/lib/providers/manual-import.ts` | `Verified` (from import) | Reads the user's own CSV uploads via `/import`. Auto-promoted from `mock` once a signed-in user has at least one non-archived dataset. |
| `official` | `src/lib/providers/official-adobe.ts` | `Public Metadata` | Public-metadata / first-party HTTP boundary. Returns empty results with a notice until `OFFICIAL_PROVIDER_BASE_URL` is configured. |

### Selection order

1. `DATA_PROVIDER` env var picks the **requested** provider.
2. If a request explicitly chose `Using demo data` (the dataset selector's
   demo scope), the mock provider is forced regardless of env.
3. If the requested provider is `mock` and the caller passes a `userId`
   that has imported data, the manual provider is auto-promoted in.
4. Per-request fallback: when the chosen provider throws
   `ProviderRequiresUserError`, `ProviderNoDataError`,
   `ProviderFeatureUnsupportedError`, or `ProviderNotImplementedError`,
   `runProvider()` falls back to mock so the UI never breaks.
5. The `official` provider deliberately does **not** throw on missing
   configuration — it returns an empty, honestly-labeled response with a
   `notice` so the UI surfaces *"not configured"* rather than silently
   substituting fake mock numbers.

### Capabilities map (per-provider feature support)

Every provider exposes a static `capabilities` map so the API layer can
tell the UI exactly what it can and cannot do without round-tripping
through a search call first:

| Feature | mock | manual | official (configured) | official (unset) |
| --- | --- | --- | --- | --- |
| Keyword search | supported | supported | supported | supported (empty) |
| Contributor / Portfolio | supported | supported | partial | partial (empty) |
| Heat Map | supported | supported | unsupported → falls back | unsupported → falls back |
| Trending keywords | supported | supported | unsupported → falls back | unsupported → falls back |
| Similar Image Search | supported (demo ranking) | supported (metadata-similarity proxy over imports) | unsupported (honest empty + notice) | unsupported (honest empty + notice) |
| Dashboard analytics rollup | supported (Demo Data) | supported (Verified from import) | partial (honest `Unavailable` per metric) | partial (honest `Unavailable` + notice) |
| Verified download counts | provided as `Demo Data` | provided as `Verified from import` | not provided (`metricsAvailable: false`) | not provided |

`unsupported → falls back` means `runProvider()` automatically falls back
to the manual provider (when the user has imported data) or otherwise to
mock, so the existing Heat Map and Trending pages continue to render.

### Data quality labeling rules

Every result passes through one of four labels. The UI shows the matching
badge on every figure, never just the bare number:

| Label | When to use |
| --- | --- |
| `Demo Data` | Mock provider, or any synthetic content. |
| `Estimated` | Numbers we computed (e.g. performance score). |
| `Public Metadata` | Official provider, sourced from publicly visible pages. |
| `Verified` | First-party signed feed (Adobe API, contributor's own export). |

**Hard rule:** we never tag a number `Verified` unless it actually came
from a first-party signed source. The manual provider tags imports
`Verified` because the user *is* the first party for their own CSV. The
official provider currently caps out at `Public Metadata` even when
configured — promote it to `Verified` only after wiring it to a real
signed feed.

---

## 2. PRD feature matrix

Status legend:

- **Implemented** — feature works end-to-end on at least one provider.
- **Partial** — feature exists but has known limitations called out in the UI.
- **Mock / import-based** — works on mock + manual; official either not
  supported or returns honest "not configured" state.
- **Estimated** — derived from observable signals; UI shows the
  `Estimated` badge.
- **Pending** — interface present, implementation deferred.

| § | PRD Feature | State | Notes |
| --- | --- | --- | --- |
| 5.1 | **Search** — keyword search, content-type / sort / AI filters, results grid, pagination | **Implemented** (mock + manual + official) | All filters honored on every provider. Result cards keep all PRD fields (id, title, thumbnail, contributor, categories, content type, upload date, keywords, Adobe Stock URL). |
| 5.1 | Download count + Performance score on result card | **Mock / import-based** | Mock + manual show real numbers (with `Demo Data` / `Verified` badges respectively). Official shows `—` + `Unavailable` because public pages don't expose verified downloads. |
| 5.1 | Recent searches + Saved/favorites + AI saturation indicator | **Implemented** (mock + manual + official) | Provider-agnostic; all sources flow through the same UI. |
| 5.2 | **Portfolio Tracker** — contributor lookup, overview cards, content breakdown, asset grid, top keywords | **Implemented** (mock + manual) / **Partial** (official) | `/portfolio` accepts contributor name, numeric ID, or stock.adobe.com URL (parsed by `parseContributorInput`). Mock + manual fully supported. Official returns empty totals + a "partial supported" notice when not configured; once configured, returns real metadata with `Public Metadata` quality and `metricsAvailable: false` on every asset so download/avg/best stats render `—` + `Unavailable`. |
| 5.2 | Best sellers (top 10) | **Implemented** (mock + manual) / **Partial** (official) | Mock + manual sort by downloads. Official falls back to performance-score sort and renders "Unavailable" per row. |
| 5.2 | Monthly trends (12-month chart) | **Estimated** (mock + manual) / **Unavailable** (official) | Computed from imported data when available; tagged `Estimated` (best-effort, derived from upload-date buckets). Official cannot reconstruct time-series downloads from public metadata, so the panel renders an honest "Unavailable" state. |
| 5.2 | Keyword analysis | **Implemented** (mock + manual) / **Partial** (official) | Frequency table + per-keyword average downloads. Avg-download column shows `—` when downloads aren't available from the active provider. Copy-to-clipboard supported on every provider. |
| 5.2 | Compare contributors | **Foundation — Coming Soon** | A/B input UI present on `/portfolio`; submitting shows a "Coming Soon" notice. Side-by-side metric comparison is intentionally deferred to a later PR. |
| 5.2 | Portfolio Export CSV (multi-section: overview + asset list + keyword analysis) | **Implemented** | Dedicated `/api/portfolio/export` endpoint produces a 3-section CSV. Honors `metricsAvailable` and `capabilities.downloadsAvailable`: unavailable cells render `Unavailable`, never fake `0`. Records an export-history row with the active dataset scope. |
| 5.3 | **Heat Map** — niche grid, competition coloring, trends | **Implemented** (mock + manual) / **Unsupported** (official) | Manual provider aggregates real keywords from imports (downloads, asset count, competition, trend, avg performance, opportunity score). Mock provides 12 demo niches with synthesized top assets. Official explicitly throws `ProviderFeatureUnsupportedError` and `runProvider` falls back to mock/manual; UI shows the data-source banner so the user always knows the active source. |
| 5.3 | Heat Map filters — content type, time period, minimum downloads, sort | **Implemented** (mock + manual) | All four filters affect provider aggregation, not just the displayed grid. `/api/heatmap?contentType=&period=&minDownloads=&sort=` is normalized server-side via `parseHeatmapFilters`. Manual provider applies content-type and period to the underlying asset set before grouping; mock provider tags each demo niche with a primary content type. |
| 5.3 | Opportunity Score | **Implemented** (mock + manual) — always tagged Estimated | Single source of truth in `src/lib/heatmap.ts#calculateOpportunityScore`. Combines demand (50pt log-scaled vs the largest niche), inverse competition (25pt), avg performance (15pt), and trend (10pt). Range 0–100. Always treated as Estimated even when downloads come from imported data, because trend and competition are heuristics. |
| 5.3 | Niche detail drilldown — top assets, related keywords, content-type breakdown | **Implemented** (mock + manual) / **Unsupported** (official) | Clicking a heat-map tile opens a Radix dialog drawer that calls `/api/heatmap?niche=<keyword>` to fetch a single-tile detail response. Top-8 assets sorted by downloads then performance, related keywords surfaced from co-occurrence in the same scope, content-type breakdown rendered as a percentage bar. |
| 5.3 | Opportunity Finder — "Best Opportunities" section | **Implemented** (mock + manual) | Surfaces top niches sorted by opportunity score, filtered to competition ≤ 60 (with a graceful fallback to top-by-opportunity when strict filter yields nothing). Each row shows the data-quality badge so the user sees `Demo Data` / `Verified` consistently. |
| 5.3 | Heat Map CSV export — niche list + niche detail | **Implemented** | Dedicated `/api/heatmap/export` endpoint produces either a single-row-per-niche "list" CSV or a multi-section "detail" CSV (overview + top assets + related keywords + content-type breakdown). Honors `metricsAvailable` and `capabilities.downloadsAvailable` so unavailable cells render `Unavailable` rather than fake `0`. Records an `ExportHistory` row with `type = "heatmap"`, the active dataset scope, and the applied filters. |
| 5.4 | **Dashboard** — quick stats, recent searches, saved preview, search-usage progress | **Implemented** (mock + manual) / **Partial** (official) | **UI completed in PR #14.** `/api/dashboard` returns three concerns: (1) account-wide activity counters from the DB (searches today, saved assets, exports made, tracked contributors, imported assets) — always truthful regardless of provider; (2) provider-derived analytics rollup via `runDashboard()` (total downloads, average performance score, content-type breakdown, top performers, keyword highlights, trending widget) with per-metric `*Available` companion flags; (3) recent search history + saved-assets preview rows tagged with the active provider's data quality. Mock synthesizes a demo portfolio from `TRENDING_KEYWORDS` and tags every figure `Demo Data`. Manual aggregates the user's imports under the active dataset scope and tags figures `Verified` (downloads gated on `metricsAvailable`). Official returns an honestly-labeled response with every `*Available: false` and a notice — the UI renders `Unavailable` rather than fake zeros. The `/dashboard` page now renders quick-stats cards, a performance-analytics section, saved-assets preview, recent-searches widget, trending-keywords widget, a plan-usage preview card, and quick actions. See §8 and §9. |
| 5.4 | Trending keywords on dashboard | **Implemented** (mock + manual) / **Unavailable** (official) | Backed by `runDashboard().trendingKeywords` (top 8 by recent volume, derived locally from imports for manual; canned demo for mock). The `/dashboard` page additionally fetches `/api/search/trending` for the larger trending widget. |
| 5.5 | **Similar Image Search** | **Implemented** (mock + manual, metadata proxy) / **Unsupported** (official) | `/search` shows a "Search by image" panel (toggle in the search bar) that accepts an image upload, an image URL, or a free-text hint. POST `/api/search/similar` runs the chosen provider and returns the same result shape as keyword search, plus a `similarityScore` (0–100) and a per-row `similarityAvailable` flag. Mock provider returns demo similar-image results ranked by token overlap (`Demo Data` envelope). Manual provider ranks the user's imported assets by metadata-similarity proxy — title-token Jaccard, keyword overlap, category/content-type match, plus a 100-point boost when the URL exactly matches `adobeStockUrl`/`thumbnailUrl`. Manual responses are tagged `Estimated`, never `Verified`, because the *ranking* is a metadata heuristic — not real visual AI. Official provider returns an empty result with a clear notice ("not available from this public-metadata source") — no scraping, no internal Adobe APIs, no proxy rotation. Result cards reuse the existing UI (favorites work; selection works) plus a Similarity tile. CSV export sends `type = "similar"` to `/api/export`, which adds a `Similarity Score` column and records an export-history row. |
| 5.5 | Similar Image Search — Find similar from a card | **Implemented** | Every keyword-search result card now has an active "Find similar" button (replaces the previous "Coming Soon" stub). Clicking it opens the Similar Image Search panel, seeds the URL field with the asset's Adobe Stock URL (or thumbnail), and runs the metadata-similarity ranking. |
| 5.6 | **Export CSV** | **Implemented** | `/export` route + history page. CSV columns match PRD §5.6. Each export row records the active dataset scope. Similar Image Search exports use `type = "similar"` and add a leading `Similarity Score` column; cells render `Unavailable` when `similarityAvailable: false`. |
| 5.7 | **Saved / Favorites** | **Implemented** | Heart button on result cards persists to `Favorite`; `/saved` page renders a grid + table across two tabs (Saved assets / Saved searches) with a collection sidebar. |
| 5.7 | Saved searches | **Implemented** (mock + manual) / **Partial** (official) | Explicit "Save this search" button on `/search` persists keyword + filter set to `SavedSearch` with a provider + data-quality + dataset-scope snapshot at save time. `/saved` table re-runs each pinned search back to `/search?q=&sort=&contentType=&aiFilter=` so the filter restore is lossless. |
| 5.7 | Collections / folders | **Implemented** | `Collection` model; create / rename / delete from the `/saved` sidebar. Assign any favorite or saved-search row via a per-row picker; deleting a collection falls its contents back to Uncategorized (never cascades). Names are unique per-user (case-insensitive). |
| 5.7 | Track delta since save | **Implemented (manual)** / **Unavailable (mock, official)** | `Favorite.downloads` / `performanceScore` are snapshotted at save time and never overwritten. `/api/saved/track` refreshes a "current" figure by looking each saved asset up by `externalId` in the active dataset scope — verified from import when found; honestly `Unavailable` otherwise. Mock and official providers cannot supply a live current number, and we never fabricate one. Per-row `lastChecked*` columns persist the most recent refresh so the delta card survives reloads. |
| 5.8 | **Trending keywords** | **Implemented** (mock + manual) / **Unsupported → falls back** (official) | Manual aggregates per-keyword volume + period-over-period growth from imported assets. Mock provides canned demo trending tagged `Demo Data`. Official explicitly throws `ProviderFeatureUnsupportedError` and `runProvider` falls back to manual / mock. |
| 5.8 | Trending filters — period, content type, minimum volume, sort | **Implemented** (mock + manual) | All four filters affect provider aggregation, not just the displayed list. `/api/search/trending?period=&contentType=&minVolume=&sort=&limit=` is normalized server-side via `parseTrendingFilters`. Manual provider applies content-type to the underlying asset set before grouping; both providers honor `minVolume` and respect the active dataset selector scope. |
| 5.8 | **Rising niches** | **Implemented** (mock + manual) | Manual derives rising niches from keywords with positive period-over-period growth (≥ 2 assets, ≥ minimum volume). Mock surfaces heat-map niches with `trend === "up"`, ranked by synthesized growth. Both tag the matching `Demo Data` / `Verified` quality badge per row. |
| 5.8 | **Top performers this week / period** | **Implemented** (mock + manual) | Manual filters imported assets by `uploadDate` within the selected period and sorts by downloads + performance score. Mock synthesizes per-period downloads from the trending-keyword sample. Each row links to the live Adobe Stock URL. UI honors the active period filter (7d / 30d / 90d / 1y). |
| 5.8 | **Seasonal trends** | **Implemented (estimated)** (mock + manual) | Manual buckets each keyword's lifetime downloads by upload month, requires ≥ 6 distinct months and a peak-vs-average lift ≥ 1.5× before labeling a keyword seasonal — keywords without enough months render `Unavailable` rather than fabricating a peak. Mock uses a fixed seasonal table tagged `Demo Data`. The seasonal panel always shows the `Estimated` data-quality badge on imported data because the signal is derived from upload distribution, not search-volume telemetry. |
| 5.8 | Trending CSV export | **Implemented** | `/api/trending/export` POST endpoint produces a five-section CSV (meta, trending keywords, rising niches, top performers, seasonal trends). Honors `metricsAvailable` and `capabilities.downloadsAvailable`: unavailable cells render `Unavailable`, never fake `0`. Records an `ExportHistory` row with `type = "trending"`, the active filter set, and the dataset scope tag. |
| 5.8 | Official Adobe trending | **Unavailable / honest** | Public-metadata sources do not expose aggregated trending search volume; the provider therefore advertises `trending: "unsupported"` in its capabilities and `runProvider` falls back to the manual / mock provider so the UI always renders something usable. The "Trending not supported" empty-state surfaces only if a future configuration explicitly chooses official-only without fallback. |
| 6 | **Auth** — credentials + Google OAuth | **Implemented** | NextAuth.js with credentials + Google. Google provider is wired conditionally: when `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1` are all set, the login/register pages render an enabled "Continue with Google" button; otherwise the button renders disabled with "not configured for this deployment" copy. See §11 for the full PR #16 auth status. |
| 6 | **Forgot / reset password** | **Implemented (dev-mailer pending)** | `/auth/forgot-password` + `/auth/reset-password` pages + `/api/auth/forgot-password` + `/api/auth/reset-password` endpoints. Tokens are 32-byte random, bcrypt-hashed in the `PasswordResetToken` table, one-time use, 60-min expiry. The forgot-password endpoint always returns a neutral 200 (no email enumeration). In dev mode the response includes a clickable reset URL; production will email it once the mailer wiring lands. See §11. |
| 6 | **Device limit** (foundation) | **Foundation — not enforced yet** | PRD device limits (FREE/STARTER 1, PRO 3, ANNUAL 5) are surfaced via `/api/devices` + `/auth/device-limit` and a Settings card. Every sign-in writes a best-effort `Device` row. Soft revoke (`isActive=false`) is supported. Hard blocking of sign-ins over the limit is intentionally deferred — see §11 for the rationale. |
| 7 | **Pricing / SaaS plans** | **Pending** | Plan field exists in `User` schema; gating + Stripe / PayPal / Cryptomus checkout not implemented. |
| 8 | **Database schema** | **Implemented** | Prisma schema covers `User`, `Account`, `Session`, `Device`, `PasswordResetToken`, `SearchHistory`, `Favorite`, `Collection`, `SavedSearch`, `ExportHistory`, `ImportedDataset`, `ImportedAsset`. |

---

## 3. Honest data-source labeling

Per PRD hard constraints, the app does **not**:

- Run a live Adobe Stock scraper from any deployed instance.
- Use private / internal Adobe APIs.
- Rotate proxies, evade user-agents, or bypass anti-bot measures.
- Claim real Adobe Stock download/sales data unless the source is verified.

What the app **does** for download-related fields:

| Source | Label | Where |
| --- | --- | --- |
| User-uploaded CSV row with a `downloads` column | `Verified from import` (`Verified`) | `manualImportProvider`. |
| Computed performance score / downloads-per-month | `Estimated` | `calculatePerformanceScore` / `calculateDownloadsPerMonth`. |
| Configured public-metadata endpoint | `Public Metadata`, with `metricsAvailable: false` on every asset → result card renders `—` + `Unavailable` | `officialAdobeProvider`. |
| Mock data | `Demo Data` | `mockProvider`. |

The `metricsAvailable: false` flag is the key: it turns the `Downloads` and
`Performance` cards on every result into `—` + `Unavailable`. We never show
a fake `0` and call it a real Adobe download number.

---

## 4. Wiring the official provider

Until `OFFICIAL_PROVIDER_BASE_URL` is set, the official provider returns
empty results with a "Public-metadata source not configured" notice in the
UI. When you have an authorized endpoint, point it at one of:

- The Adobe Stock Search API (when contributor analytics endpoints become
  available to your tenant).
- A first-party signed analytics export (in which case bump the
  `dataQuality` to `verified` at the integration layer).
- A worker / proxy you operate that mirrors public Adobe Stock pages
  while respecting `robots.txt` and rate limits.

### Expected response shapes

`GET ${OFFICIAL_PROVIDER_BASE_URL}/search?keyword=...&contentType=...&sort=...&page=...&pageSize=...`

```json
{
  "totalResults": 12345,
  "results": [
    {
      "id": "string",
      "thumbnailUrl": "https://...",
      "title": "string",
      "downloads": 0,
      "contentType": "photo",
      "categories": ["business", "office"],
      "uploadDate": "2024-01-15T00:00:00Z",
      "contributorName": "Jane Doe",
      "contributorId": "12345",
      "isPremium": false,
      "isAiGenerated": false,
      "keywords": ["business", "office"],
      "adobeStockUrl": "https://stock.adobe.com/..."
    }
  ]
}
```

Numeric download fields are **optional**. Sources that can only return
metadata should omit `downloads` and the result card will render
`Unavailable`.

`GET ${OFFICIAL_PROVIDER_BASE_URL}/contributor?query=<name|url>`

```json
{
  "name": "Jane Doe",
  "id": "12345",
  "joinDate": "2018-03-21T00:00:00Z",
  "totalAssets": 1234,
  "assets": [/* same shape as /search.results[] */]
}
```

If the endpoint requires authentication, set `OFFICIAL_PROVIDER_API_KEY`
and it will be sent as `Authorization: Bearer <key>` on every request.

### Failure semantics

- Any HTTP non-2xx is logged and surfaces as a 500 to the API caller —
  `runProvider` does not fall back to mock for transport errors, so the
  user sees the failure rather than silently switching to demo data.
- Network timeouts default to 8 seconds (`FETCH_TIMEOUT_MS`).
- Responses are not cached through Next's data cache (`cache: "no-store"`)
  so we never serve stale "not reachable" results.

---

## 5. Portfolio Tracker — feature × provider matrix

PR #9 brought the Portfolio Tracker close to the PRD §5.2 spec. Per-provider
support breaks down as follows:

| Sub-feature | mock | manual (CSV) | official (configured) | official (unset) |
| --- | --- | --- | --- | --- |
| Contributor lookup by name / ID / URL | yes (demo set) | yes (matches imported `contributorName` / `contributorId`) | partial (HTTP boundary) | empty + notice |
| Total assets / Total downloads / Avg downloads | demo | verified from import | partial (downloads `Unavailable`) | empty |
| Best performing asset | demo | verified | partial (`Unavailable` if no downloads) | empty |
| Portfolio age (joined-date) | demo | verified | metadata if endpoint provides | empty |
| Content breakdown (photo/illustration/vector/video/other) | demo | verified | metadata-derived | empty |
| Best sellers (top 10) | demo | sorted by verified downloads | sorted by perf-score, "Unavailable" per row | empty |
| Asset grid + per-asset selection | yes | yes | yes (downloads cells `Unavailable`) | empty |
| Keyword analysis (frequency + avg downloads) | demo | verified avg | frequency only; avg `—` | empty |
| 12-month monthly trends | demo | estimated from upload-date buckets | rendered as "Unavailable" panel (cannot reconstruct from public metadata) | "Unavailable" |
| Compare contributors | foundation only — A/B input + "Coming Soon" notice | foundation only | foundation only | foundation only |
| Export CSV (multi-section) | yes (Demo Data labels) | yes (Verified labels) | yes ("Unavailable" cells where downloads aren't provided) | yes (empty / contextual) |

**Which metrics depend on imported data?**

- Total downloads, Total downloads in Best Sellers, Avg downloads, Avg
  downloads per keyword, and Monthly Trends are all **download-bearing**
  metrics. They render verified numbers only when the active provider
  declares `capabilities.downloadsAvailable === true` (mock + manual).
- Asset count, content type breakdown, keyword frequency, and the
  contributor name / join date are **metadata** metrics — they work on
  every provider including the official public-metadata one.

**Which metrics are unavailable from official / public providers?**

- Verified downloads (per asset and aggregated).
- Time-series monthly download trends.
- Sales / revenue (never claimed for any provider).

The UI labels each unavailable figure as `Unavailable` rather than `0` so
users always know whether a number is a real download count, an estimate,
or simply not available from their current data source.

---

## 6. What this PR (#8) added

- `ProviderCapabilities` map on every provider (search / contributor /
  heatmap / trending / similar-image + verified-downloads flag).
- `ProviderFeatureUnsupportedError` so providers can opt out of features
  cleanly without claiming them unsupported in the type system.
- `metricsAvailable` on `SearchAsset` to gate the per-figure
  Unavailable rendering.
- `notice` on every provider result envelope, surfaced in `/search` and
  `/portfolio` as a *"Partial support / Heads up"* banner when present.
- `officialAdobeProvider` rebuilt as a configurable HTTP boundary that
  honors `DATA_PROVIDER=official`, supports the PRD search shape, and
  returns honest empty/partial state until `OFFICIAL_PROVIDER_BASE_URL`
  is set.
- "Find similar" button labeled **Coming Soon** (no provider supports
  similar-image search yet).
- `OFFICIAL_PROVIDER_BASE_URL` + `OFFICIAL_PROVIDER_API_KEY` env vars
  documented in `.env.example` and in this doc.

What was deliberately **not** added in this PR:

- Live scraping, proxy rotation, or user-agent evasion.
- Private/internal Adobe API calls.
- Real or simulated download numbers attached to public-metadata results.
- Similar Image Search implementation.
- Pricing / SaaS gating.

These are explicit non-goals of PR #8 per the user's brief and the PRD's
hard constraints.

---

## 8. Dashboard backend — status by provider (PR #13)

PR #13 turned `/api/dashboard` from a flat counter endpoint into a
provider-aware analytics rollup. Selection mirrors the rest of the app:
the dataset selector’s scope (all / specific / demo) flows through to the
dashboard, and `runDashboard()` falls back to mock when the requested
provider can’t fulfill the request (e.g. official without a configured
feed).

### Response shape

```
{
  signedIn, hasImportedData,
  searchesToday, savedAssets, exportsMade, trackedContributors, importedAssets,
  datasetScope, datasetName, scopeReason,
  recentSearches[],
  savedAssetsPreview[]: { id, assetId, thumbnailUrl, title, contributorName,
                         downloads, performanceScore, keywords, savedAt,
                         dataQuality, providerName },
  analytics: ProviderDashboardResult,   // see below
  provider: { id, name, dataQuality, capabilities, notice }
}
```

`analytics` (`ProviderDashboardResult`) carries:

| Field | Type | Notes |
| --- | --- | --- |
| `importedAssets` / `importedAssetsAvailable` | `number` / `boolean` | Total assets in scope. Mock: demo pool size. Manual: imported asset count. Official: `0` + `Available: false`. |
| `totalDownloads` / `totalDownloadsAvailable` | `number` / `boolean` | Sum of in-scope downloads. Mock: demo. Manual: gated on `metricsAvailable`. Official: unavailable. |
| `averagePerformanceScore` / `*Available` | `number` / `boolean` | 0–100 mean. Manual ignores `performanceScore === 0` rows so metadata-only imports don’t depress the figure. |
| `contentBreakdown` / `*Available` | `{ type, count, pct }[]` / `boolean` | Per-content-type asset counts + percentage. Always available on mock + manual. |
| `topPerformers` / `*Available` | `TopPerformer[]` / `boolean` | Up to 8 in-scope assets sorted by downloads then performance. |
| `keywordHighlights` / `*Available` | `DashboardKeywordHighlight[]` / `boolean` | Top 8 keywords by downloads then asset count. Each row carries its own `metricsAvailable` so the UI can render `—` when downloads aren’t derivable. |
| `trendingKeywords` / `*Available` | `TrendingKeyword[]` / `boolean` | Lightweight widget data. Manual derives from a `30d` recent vs prior bucket on `uploadDate`; mock pulls from `TRENDING_KEYWORDS`. |
| `dataQuality` | `"demo" \| "estimated" \| "public_metadata" \| "verified"` | Envelope-level label. UI uses this for the page banner + per-card badge. |
| `providerId` / `providerName` / `capabilities` / `notice` | envelope fields | Same shape as every other provider response. |

### Per-provider matrix

| Metric | mock (Demo Data) | manual (Verified) | official configured (Public Metadata) | official unset |
| --- | --- | --- | --- | --- |
| `searchesToday` / `savedAssets` / `exportsMade` / `trackedContributors` | from DB | from DB | from DB | from DB (or zeros for guests) |
| `importedAssets` (counter) | 0 unless demo scope synthesizes | scoped imported asset count | scoped imported asset count | scoped imported asset count |
| `totalDownloads` | demo | verified-from-import (gated on `metricsAvailable`) | **Unavailable** (`Available: false`) | **Unavailable** + “not configured” notice |
| `averagePerformanceScore` | demo | verified mean over rows with non-zero score | **Unavailable** | **Unavailable** |
| `contentBreakdown` | demo | verified counts (incl. `unknown` bucket) | **Unavailable** | **Unavailable** |
| `topPerformers` | demo top 8 | top 8 by downloads then perf | **Unavailable** | **Unavailable** |
| `keywordHighlights` | demo top 8 | top 8 by downloads then assets | **Unavailable** | **Unavailable** |
| `trendingKeywords` (widget) | canned demo | derived 30d window | **Unavailable** | **Unavailable** |
| `recentSearches` | from `SearchHistory` | from `SearchHistory` | from `SearchHistory` | empty (guest) |
| `savedAssetsPreview` | from `Favorite` rows | from `Favorite` rows | from `Favorite` rows | empty (guest) |

**Dataset-scope awareness.** The same scope that powers Search /
Portfolio / Heat Map flows through to the dashboard. “All datasets”
aggregates every non-archived dataset; “Selected dataset” narrows to one;
“Demo” forces the mock provider even for users with imports. The
`importedAssets` counter is always 0 under demo scope (the user asked
for demo data, so we honor it). The provider-derived analytics envelope
follows the same routing rules — see §1 “Selection order.”

### What’s implemented in PR #13

- `ProviderCapabilities.dashboard` flag on every provider.
- `ProviderDashboardResult` type + `runDashboard()` helper.
- `mockProvider.dashboard()` synthesizes a demo “portfolio” from
  `TRENDING_KEYWORDS` (every figure tagged `Demo Data`).
- `manualImportProvider.dashboard()` aggregates imports within the
  active dataset scope (`Verified`; downloads gated on
  `metricsAvailable`).
- `officialAdobeProvider.dashboard()` returns an honestly-labeled
  `Public Metadata` envelope with every `*Available: false` and a
  notice — no fake numbers.
- `/api/dashboard` returns activity counters + analytics rollup +
  recent searches + saved-assets preview in one response.

### What’s deferred to future Dashboard work

See §9 for the PR #14 Dashboard UI status. Items still outstanding
after PR #14:

- Persisting the active provider on each `SearchHistory` row so the
  recent-searches widget can show a per-row provider badge (today we
  show the current provider in the card header only).
- Delta-since-save on each saved-asset preview row (depends on the
  Saved Collections work in a future PR).
- Plan gating (Stripe / PayPal / Cryptomus checkout + daily search
  limit enforcement) — the plan-usage card is rendered as a preview
  until gating lands.

---

## 9. Dashboard UI — status by widget (PR #14)

PR #14 wires the full PR #13 backend response into `/dashboard`. The
dashboard page now reads entirely from `/api/dashboard` and refreshes
automatically when the user switches datasets via the top-bar selector
(`ACTIVE_DATASET_CHANGED_EVENT`). No widget renders hardcoded placeholder
numbers; every figure either comes from the API response or renders an
honest `Unavailable` state via `UnavailableCardState`.

### Widget matrix

| Widget | Source field | Mock (Demo Data) | Manual (Verified) | Official (Public Metadata / Unset) |
| --- | --- | --- | --- | --- |
| **Data-source banner** | `datasetScope` + `provider.dataQuality` | "Using demo data" | "Using all imported datasets" or "Using dataset: <name>" | honest banner with provider name + quality chip |
| **Quick stats — Searches today** | `searchesToday` | signed in: DB-backed; guest: 0 | signed in: DB-backed | signed in: DB-backed |
| **Quick stats — Saved assets** | `savedAssets` | DB-backed | DB-backed | DB-backed |
| **Quick stats — Exports made** | `exportsMade` | DB-backed | DB-backed | DB-backed |
| **Quick stats — Tracked contributors** | `trackedContributors` | DB-backed (distinct contributor names on favorites) | DB-backed | DB-backed |
| **Quick stats — Imported assets** | `importedAssets` | 0 (demo scope does not mix with imports) | scoped count | scoped count |
| **Quick stats — Dataset scope tile** | `datasetScope` + `provider.name` | "Demo data · Mock data provider" | "<dataset name>" or "All imported datasets" | "User imported data" / "Public metadata" label |
| **Performance — Total downloads** | `analytics.totalDownloads` + `*Available` | demo figure, `Demo Data` badge | verified figure, `Verified` badge | **Unavailable** card |
| **Performance — Avg performance score** | `analytics.averagePerformanceScore` + `*Available` | demo figure | verified mean over non-zero rows | **Unavailable** card |
| **Performance — Assets in scope** | `analytics.importedAssets` + `*Available` | demo figure | scoped asset count | **Unavailable** card |
| **Performance — Top performing assets** | `analytics.topPerformers` + `*Available` | 5 demo rows | 5 top-by-downloads then perf | **Unavailable** card |
| **Performance — Content type breakdown** | `analytics.contentBreakdown` + `*Available` | demo bars | verified percentage bars | **Unavailable** card |
| **Performance — Keyword highlights** | `analytics.keywordHighlights` + `*Available` | demo chips | verified chips, per-row `metricsAvailable` gates the download counter | **Unavailable** card |
| **Recent searches** | `recentSearches[]` | DB-backed; "Re-run" links to `/search?q=` | DB-backed | DB-backed |
| **Saved assets preview** | `savedAssetsPreview[]` | DB-backed rows tagged `Demo Data` | DB-backed rows tagged `Verified` | DB-backed; empty for guests with CTA |
| **Trending keywords** | `analytics.trendingKeywords` + `*Available` | canned demo list | derived 30d window | **Unavailable** card |
| **Plan usage preview** | `/api/user/me` + `searchesToday` | signed in: shows plan + count; guests: CTA | same | same |
| **Quick actions** | static routes | 5 buttons to `/search`, `/import`, `/portfolio`, `/trending`, `/export` | same | same |

### What’s implemented in PR #14

- `useDashboardData` hook that fetches `/api/dashboard` +
  `/api/user/me` in parallel and refetches on dataset-selector change.
- Six quick-stats tiles reflecting the full counter payload plus the
  active dataset scope.
- `<PerformanceAnalytics>` section with three metric blocks
  (downloads, average performance, scope size) plus three panels (top
  performers, content-type breakdown, keyword highlights). Every panel
  honors the matching `*Available` flag.
- `<SavedAssetsPreview>` grid with per-row `DataQualityBadge`,
  `thumbnail`, `title`, `contributor`, `savedAt`, and an "Open" action
  routing to `/saved`. Clean empty states for guests and
  nothing-saved-yet.
- `<RecentSearchesWidget>` with keyword, filter chips, result count,
  relative time, and a one-click "Re-run" that re-dispatches the
  keyword to `/search`.
- `<TrendingKeywordsWidget>` scoped to the dashboard rollup (not the
  full `/api/search/trending` payload).
- `<PlanUsageCard>` — preview-only copy, honest "Plan limits not fully
  enabled yet" banner, progress bar that visualizes today's activity.
- `<QuickActionsCard>` — five buttons routing to real pages.
- Loading (`DashboardSkeleton`), error (retryable card), and
  provider-unavailable (`UnavailableCardState`) states.

### What’s deliberately not in PR #14

- Saved Collections, Auth completion (email verification / password
  reset wiring), Pricing / SaaS gating checkout, Supabase migration,
  and any new Adobe data integration — all deferred per the brief.
- Persisting per-search provider snapshots on `SearchHistory` rows.
- Real daily-search-limit enforcement (Plan Usage card remains a
  preview).
- Any scraping / proxy rotation / anti-bot bypass / fabricated Adobe
  download counts — forbidden by the PRD's hard constraints.




---

## 10. Saved / Favorites — status by capability (PR #15)

PR #15 completes the Saved/Favorites system against PRD §5.7. The
`/saved` page now owns three concerns: pinned assets, pinned searches,
and user-defined collections. Track-changes is a first-class feature
with honest per-provider semantics.

### Data model additions

- `Favorite.collectionId` (SetNull on Collection delete), `Favorite.notes`.
- `Favorite.lastCheckedAt`, `lastCheckedDownloads`,
  `lastCheckedPerformanceScore`, `lastCheckedDataQuality`,
  `lastCheckedProviderId` — snapshot of the most recent
  `/api/saved/track` refresh.
- New `Collection` model (`userId + name` unique, case-insensitive dedupe
  at the API layer). Holds both favorites and saved searches.
- New `SavedSearch` model — keyword + filter set, plus a provider +
  data-quality + dataset-scope snapshot at save time. Dataset scope is
  stored as the same string tag (`all_datasets` / `selected_dataset` /
  `demo_data`) used by `ExportHistory` so archived / renamed datasets
  don't break the saved row.

### API surface

- `GET/POST /api/favorites` — list + upsert. POST preserves the saved-at
  snapshot on re-save (downloads / performanceScore never overwritten).
- `PATCH /api/favorites` — move an asset between collections / edit its
  notes without unsaving.
- `DELETE /api/favorites?assetId=…` — unsave (existing behavior
  preserved).
- `GET/POST /api/collections`, `PATCH/DELETE /api/collections/[id]` —
  full CRUD with user-scoped ownership checks on every mutation.
- `GET/POST /api/saved-searches`,
  `PATCH/DELETE /api/saved-searches/[id]` — full CRUD. PATCH allows
  renaming / moving / editing notes but NOT editing the stored filter
  set; users delete + re-save to change the query so we never silently
  drift from what they pinned.
- `POST /api/saved/track` — refresh the "current" downloads /
  performance figure for up to 200 saved assets. Always returns a row
  per input favorite with `available: true/false` and persists the
  result on the `Favorite` row.
- `POST /api/saved/export[?collectionId=…]` — 3-section CSV (meta +
  saved_asset + saved_search). Records an `ExportHistory` row with
  `type = "saved"`. Unavailable cells (no track-changes data, or
  provider unsupported) render `Unavailable` rather than `0`.

### Per-provider track-changes matrix

| Capability | mock (Demo) | manual (Verified) | official configured (Public Metadata) | official unset |
| --- | --- | --- | --- | --- |
| Current downloads | **Unavailable** (synthesized per-query, no stable source) | **Verified** when the saved asset's `externalId` matches a scoped `ImportedAsset` | **Unavailable** (public pages do not expose verified downloads) | **Unavailable** + "not configured" notice |
| Current performance score | **Unavailable** | **Verified** when imported row includes it; otherwise derived via `calculatePerformanceScore` and surfaced as `Estimated` | **Unavailable** | **Unavailable** |
| Delta downloads / performance | **Unavailable** | Computed from saved-at snapshot | **Unavailable** | **Unavailable** |
| Last-checked timestamp | persisted on every call so "last checked N ago" works regardless of availability | persisted | persisted | persisted |

**Hard rule preserved.** The `/api/saved/track` endpoint does NOT fall
through to mock when the manual provider can't find a match — users
explicitly chose to pin a specific row; faking a refreshed number would
undo the promise of the `Verified` badge. Users see a truthful
"Unavailable — import a CSV to enable" banner instead.

### `/saved` UI

- Left rail: collection sidebar with "All saved", "Uncategorized", and
  every custom folder. Inline create / rename / delete.
- Main pane: tab switcher between Saved Assets (card grid with
  thumbnail, contributor, delta chips, collection picker, data-quality
  badge) and Saved Searches (table with keyword, filter badges,
  provider + quality snapshot, collection picker, one-click Re-run).
- Toolbar: "Check for updates" (calls `/api/saved/track`),
  "Export CSV" (honors active collection filter), "Find more"
  (`/search`).
- Empty states are distinct per-filter: "No saved assets yet" with a
  CTA to `/search` vs "No assets in this collection" with a hint to
  move existing items.

### `/search` UI

- "Save this search" button lives between `ResultsSummary` and
  `ResultsToolbar`. Posts the current keyword + filters + resolved
  dataset scope to `/api/saved-searches`. Guests get a helpful "Sign in
  to save searches to your account" message rather than a generic 401.
- URL-param restore: `/search?q=&sort=&contentType=&aiFilter=` now
  populates filter state on first render, so `/saved` Re-run is
  lossless.

### `/dashboard` UI

- `savedAssetsPreview` now uses each favorite's own
  `lastCheckedDataQuality` when populated, falling back to the active
  provider's envelope quality. A manual-imported refreshed row stays
  `Verified` in the preview even if the user later switches back to
  mock.

### What's explicitly NOT in PR #15

- Live provider polling / background refresh. `/api/saved/track` is
  request-driven only — no cron, no websockets, no provider pings.
- Any form of Adobe scraping, proxy rotation, or anti-bot bypass.
- Supabase migration, Pricing / SaaS gating, Auth completion — all
  deferred per the PRD brief.
- Notifications for track-changes deltas (email, in-app). The UI shows
  the delta chip; the user decides what to do with it.



---

## 11. Auth completion — status by capability (PR #16)

PR #16 promotes the auth surface from "credentials + Google stub" to a
working PRD §6 footprint, while keeping enforcement-risky pieces
(device-limit hard blocking, production email delivery) deliberately
deferred so shipping them doesn't lock users out of their accounts.

### Capability × status matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Credentials sign-in / sign-up | **Implemented** | Unchanged from PR #1. Register → auto sign-in → `/dashboard`. Duplicate-email returns a structured 409 with a "Go to sign in" action link. |
| Google OAuth — enabled path | **Implemented** | When `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (server) and `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1` (client) are all set, the login/register pages render an enabled "Continue with Google" button that kicks off the standard `next-auth` redirect flow. Email-matched account linking is enabled (`allowDangerousEmailAccountLinking: true`) so a credentials user can later sign in with Google using the same email without an `OAuthAccountNotLinked` error. |
| Google OAuth — missing-env path | **Implemented (graceful disable)** | When the client flag is off, the button stays visible but disabled with a "Sign in with Google is not configured for this deployment" tooltip + subtitle. No client-side round-trip needed to know the state. |
| Forgot-password page | **Implemented** | `/auth/forgot-password` — email input, request button, loading state, error state, and a neutral "Check your inbox" success state (same copy whether or not the email is registered — prevents user enumeration). Dev mode shows a clickable reset URL on success; production never exposes the plaintext token. |
| Reset-password page | **Implemented** | `/auth/reset-password?uid=&token=` — token presence check, new + confirm password inputs (8+ char client-side validation, mismatch check, 8+ char server-side re-check), loading state, error state, success path redirects to `/auth/login?reset=1` which shows a "Password updated, sign in" banner. |
| `POST /api/auth/forgot-password` | **Implemented** | Always 200 for valid email format; issues a `PasswordResetToken` row only when the user exists AND has a `hashedPassword`. Pre-invalidates any prior pending tokens for the user so the mailbox never has two live links at once. Dev-only response fields (`devResetUrl`, `devExpiresAt`, `devNote`) are never populated in production. |
| `POST /api/auth/reset-password` | **Implemented** | Validates `{ userId, token, password }` via zod. `consumeResetToken` does a bounded bcrypt scan over pending tokens (cap 5, ordered by newest), race-free one-time consume via `updateMany({ where: { id, usedAt: null }})`, and on success invalidates every remaining pending token for the user. Never logs the plaintext; never distinguishes "bad user" / "expired" / "already used" in the response. |
| Token storage | **Implemented (secure)** | New `PasswordResetToken` model: `tokenHash` (bcrypt cost 10), `expiresAt` (60 min TTL), `usedAt` (one-time use), `createdAt`. The plaintext is 32 random bytes, URL-safe base64. |
| Email delivery | **Pending** | PR #16 is auth foundation — it does NOT ship a mailer. Dev mode returns the reset URL inline so local testing works without SMTP. Productionizing this only requires plugging a `sendMail()` call into `forgot-password/route.ts` at the marked comment; no schema/API contract changes needed. |
| Device logging on sign-in | **Implemented (best-effort)** | NextAuth `events.signIn` writes a `Device` row per successful sign-in (credentials OR Google). Device-logging failures are swallowed so they never block authentication. |
| Device limit surfacing | **Implemented (foundation)** | `/api/devices` returns `{ plan, limit, activeCount, overLimit, devices[] }` for the signed-in user. `/auth/device-limit` renders the list with soft-revoke buttons; the Settings page shows a compact "X of Y devices used" card linking to the full page. PRD-specified limits: FREE 1, STARTER 1, PRO 3, ANNUAL 5. |
| Device limit enforcement (hard block) | **Pending (by design)** | Signing a user out automatically when they exceed the cap requires a "force sign-out other device" UX we haven't built yet. Shipping the hard-block without that escape hatch is a lockout risk — we log every device and expose the count now so the next PR has everything it needs, but we don't reject sign-ins on overflow yet. |
| Duplicate-email / invalid-password copy | **Implemented** | Login collapses "no such user" + "wrong password" into one message (preserves NextAuth's anti-enumeration posture) but links directly to `/auth/register?email=<typed>`. Register 409 links directly to `/auth/login?email=<typed>`. Both pages use `role="alert"` + `aria-live="polite"` for screen readers. |
| Post-login redirect | **Implemented** | `callbackUrl` is allow-listed to same-origin relative paths (starts with `/` and not `//`). Password-reset success redirects to `/auth/login?reset=1`. |
| Guest redirect flows | **Unchanged** | Pre-PR #16 behavior preserved: `/dashboard` redirects to `/auth/login` when signed out; guest routes like `/search` still render with demo data. |

### Security notes

- No raw reset tokens are stored or logged. `bcrypt.compare` is constant-time;
  we never string-compare plaintext against plaintext.
- `NEXTAUTH_SECRET` strict-runtime validation (placeholder / too-short /
  `-not-used-at-runtime` rejection) is unchanged — PR #16 imports the
  same `assertNextAuthSecret()` helper.
- Google credentials are read from env at module load and are never sent
  to the client. The client reads only `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`
  to decide how to render the button.
- `POST /api/auth/forgot-password` returns the same response whether or
  not the email exists; both success branches construct an identical
  response object before the DB-touching work runs.

### Explicit non-goals in this PR

- Email sending wiring (SMTP / Resend / SES).
- Device-limit hard-enforcement on sign-in.
- Rate-limiting the forgot-password endpoint (deferred to the rate-limit
  middleware PR so it shares a policy with `/api/import` and the export
  endpoints).
- 2FA / TOTP / WebAuthn.
- Email verification flow (separate PR).
- Pricing / SaaS gating (Phase 4).
