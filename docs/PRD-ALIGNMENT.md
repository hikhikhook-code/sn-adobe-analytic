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
| Similar Image Search | unsupported | unsupported | unsupported | unsupported |
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
| 5.4 | **Dashboard** — quick stats, recent searches, saved preview, search-usage progress | **Implemented** | Reads search history, favorites, exports tables. |
| 5.4 | Trending keywords on dashboard | **Implemented** (mock + manual) | Same as `/trending`. |
| 5.5 | **Similar Image Search** | **Pending — Coming Soon** | "Find similar" button on every result card is disabled with a "Coming Soon" tooltip. No provider currently supports this — both mock and manual mark `similarImage: "unsupported"`. Wiring requires either a perceptual-hash index or a remote similar-image API. |
| 5.6 | **Export CSV** | **Implemented** | `/export` route + history page. CSV columns match PRD §5.6. Each export row records the active dataset scope. |
| 5.7 | **Saved / Favorites** | **Implemented** | Heart button on result cards; `/saved` page lists favorites. |
| 5.7 | Saved searches + Folders/collections + Track delta since save | **Pending** | Only individual-asset favorites are persisted; saved-search and collection grouping not yet implemented. |
| 5.8 | **Trending keywords** | **Implemented** (mock + manual) / **Unsupported → falls back** (official) | Manual aggregates per-keyword volume + period-over-period growth from imported assets. Mock provides canned demo trending tagged `Demo Data`. Official explicitly throws `ProviderFeatureUnsupportedError` and `runProvider` falls back to manual / mock. |
| 5.8 | Trending filters — period, content type, minimum volume, sort | **Implemented** (mock + manual) | All four filters affect provider aggregation, not just the displayed list. `/api/search/trending?period=&contentType=&minVolume=&sort=&limit=` is normalized server-side via `parseTrendingFilters`. Manual provider applies content-type to the underlying asset set before grouping; both providers honor `minVolume` and respect the active dataset selector scope. |
| 5.8 | **Rising niches** | **Implemented** (mock + manual) | Manual derives rising niches from keywords with positive period-over-period growth (≥ 2 assets, ≥ minimum volume). Mock surfaces heat-map niches with `trend === "up"`, ranked by synthesized growth. Both tag the matching `Demo Data` / `Verified` quality badge per row. |
| 5.8 | **Top performers this week / period** | **Implemented** (mock + manual) | Manual filters imported assets by `uploadDate` within the selected period and sorts by downloads + performance score. Mock synthesizes per-period downloads from the trending-keyword sample. Each row links to the live Adobe Stock URL. UI honors the active period filter (7d / 30d / 90d / 1y). |
| 5.8 | **Seasonal trends** | **Implemented (estimated)** (mock + manual) | Manual buckets each keyword's lifetime downloads by upload month, requires ≥ 6 distinct months and a peak-vs-average lift ≥ 1.5× before labeling a keyword seasonal — keywords without enough months render `Unavailable` rather than fabricating a peak. Mock uses a fixed seasonal table tagged `Demo Data`. The seasonal panel always shows the `Estimated` data-quality badge on imported data because the signal is derived from upload distribution, not search-volume telemetry. |
| 5.8 | Trending CSV export | **Implemented** | `/api/trending/export` POST endpoint produces a five-section CSV (meta, trending keywords, rising niches, top performers, seasonal trends). Honors `metricsAvailable` and `capabilities.downloadsAvailable`: unavailable cells render `Unavailable`, never fake `0`. Records an `ExportHistory` row with `type = "trending"`, the active filter set, and the dataset scope tag. |
| 5.8 | Official Adobe trending | **Unavailable / honest** | Public-metadata sources do not expose aggregated trending search volume; the provider therefore advertises `trending: "unsupported"` in its capabilities and `runProvider` falls back to the manual / mock provider so the UI always renders something usable. The "Trending not supported" empty-state surfaces only if a future configuration explicitly chooses official-only without fallback. |
| 6 | **Auth** — credentials + Google OAuth | **Implemented** | NextAuth.js with credentials + Google. Email verification + forgot-password flow stubbed; not yet wired to a mailer. |
| 7 | **Pricing / SaaS plans** | **Pending** | Plan field exists in `User` schema; gating + Stripe / PayPal / Cryptomus checkout not implemented. |
| 8 | **Database schema** | **Implemented** | Prisma schema covers `User`, `Account`, `Session`, `Device`, `SearchHistory`, `Favorite`, `ExportHistory`, `ImportedDataset`, `ImportedAsset`. |

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
