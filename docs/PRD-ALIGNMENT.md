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
| 5.2 | **Portfolio Tracker** — contributor lookup, totals, content breakdown, top keywords | **Implemented** (mock + manual) / **Partial** (official) | Mock + manual fully supported. Official returns empty totals + a "partial supported" notice when not configured; once configured, returns real metadata with `Public Metadata` quality. |
| 5.2 | Best sellers list + monthly trend chart | **Estimated** | Computed from imported data when available. Official: monthly trend is empty (cannot reconstruct from public metadata). |
| 5.2 | Compare contributors | **Pending** | UI not yet exposed. |
| 5.3 | **Heat Map** — niche grid, competition coloring, trends | **Implemented** (mock + manual) | Manual provider aggregates real keywords from imports. Mock provides demo niches. Official falls back to manual/mock; UI surfaces the source via the data-source banner. |
| 5.3 | Niche detail drilldown + Opportunity finder | **Pending** | Niche tile click target / detail page not wired yet. |
| 5.4 | **Dashboard** — quick stats, recent searches, saved preview, search-usage progress | **Implemented** | Reads search history, favorites, exports tables. |
| 5.4 | Trending keywords on dashboard | **Implemented** (mock + manual) | Same as `/trending`. |
| 5.5 | **Similar Image Search** | **Pending — Coming Soon** | "Find similar" button on every result card is disabled with a "Coming Soon" tooltip. No provider currently supports this — both mock and manual mark `similarImage: "unsupported"`. Wiring requires either a perceptual-hash index or a remote similar-image API. |
| 5.6 | **Export CSV** | **Implemented** | `/export` route + history page. CSV columns match PRD §5.6. Each export row records the active dataset scope. |
| 5.7 | **Saved / Favorites** | **Implemented** | Heart button on result cards; `/saved` page lists favorites. |
| 5.7 | Saved searches + Folders/collections + Track delta since save | **Pending** | Only individual-asset favorites are persisted; saved-search and collection grouping not yet implemented. |
| 5.8 | **Trending keywords** | **Implemented** (mock + manual) | Manual aggregates by keyword over imported uploads. Mock returns canned trending. Official falls back. |
| 5.8 | Rising niches + Top performers this week + Seasonal trends | **Estimated / Pending** | Trending growth is estimated from a 90/180-day rolling window over imports. Top-performers and seasonal predictions are not yet implemented. |
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

## 5. What this PR (#8) added

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
