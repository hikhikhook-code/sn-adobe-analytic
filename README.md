# SN Adobe Analytic

Adobe Stock analytics & insights for contributors — a TAS Tracker-style tool
without the paywall. Search keywords, analyze contributor portfolios, explore
niche heat maps, and export results to CSV.

> ## ⚠️ Data quality disclaimer
>
> **This MVP uses mock / demo / estimated analytics. It does not claim verified
> Adobe Stock sales, performance, or download data unless a verified data source
> is connected.**
>
> Every metric in the UI is tagged with one of:
>
> | Tag | Meaning |
> | --- | --- |
> | `Demo Data` | Synthetic numbers generated for demo. Not real Adobe Stock. |
> | `Estimated` | Computed from observable signals (not authoritative). |
> | `Public Metadata` | Pulled directly from publicly visible Adobe Stock pages. |
> | `Verified` | Sourced from a first-party signed feed (Adobe API or your own export). |
>
> Out of the box, the bundled provider is `mock`, so **everything you see is
> labeled `Demo Data`**. No live scraping, no proxy rotation, and no internal
> Adobe API calls happen anywhere in this repo. See *Data providers* below.

## Status

- **Phase 1** — search, auth, layout, mock data, all sidebar pages navigable.
- **Phase 2** — stabilization & deploy readiness:
  - Pluggable data-provider architecture (`mock` / `official` / `manual`)
  - `DataQuality` badges & banners on every analytics surface
  - GitHub Actions CI (install → prisma generate → lint → typecheck → build)
  - Production-safe live-scraper guardrails
  - Vercel deploy + SQLite → Supabase Postgres migration guide
  - UX polish (empty / loading / error states, mobile sidebar drawer)
- **Phase 3** — Manual import + user-owned data + export history:
  - Real `manualImportProvider` reading user-uploaded CSVs from the database
  - `/import` page: upload → preview → column mapping → confirm → success
  - Imported data automatically takes over Search / Dashboard / Portfolio /
    Heat Map / Trending / Saved / Export for the signed-in user (zero-config)
  - Persisted search history surfaced on the dashboard
  - Completed `/export` with history table + per-export quality tagging
- **Phase 4** — Supabase / Postgres + Vercel deploy readiness:
  - Centralized env loading & validation in `src/lib/env.ts` (strict in
    production, permissive in local dev and during CI builds)
  - `docs/DEPLOYMENT.md` — end-to-end Vercel + Supabase deploy guide with
    a 7-section post-deploy QA checklist and troubleshooting section
  - Auth UX polish: friendlier "email already registered" + "wrong
    credentials" flows with cross-links between login/register
  - Guest access to `/import` now redirects cleanly to
    `/auth/login?callbackUrl=%2Fimport`
  - `/import` serves a downloadable sample CSV and surfaces specific
    upload error messages; `/api/import*` size cap is driven by
    `MAX_IMPORT_FILE_SIZE_MB`
  - `/export` history table gains an "Actions" column with a clearly
    disabled "Download again" button (re-download is deferred)
- **Phase 6 (this PR)** — Dataset Selector + Import Management:
  - Dataset picker in the top bar, visible on every dashboard route
  - Three scopes: **All imported datasets** (aggregate), **Selected
    dataset** (single-dataset scope), **Demo data** (explicit mock)
  - Per-user persistence via `User.activeDatasetId`; orphaned selections
    (archived/deleted) silently fall back to "All datasets" with a warning
    banner
  - New `DataSourceBanner` on every analytics page clearly says what
    data source is active
  - `/import` gains a full management table: rename, archive, hard-delete,
    set active, plus source filename + skipped-row count
  - `/api/export` and `ExportHistory` record the dataset scope per export
    so history rows stay accurate after renames or archives
  - User isolation guardrails: every scope resolution re-verifies
    dataset ownership server-side before trusting a specific id
- **Phase 6+** (still deferred) — official Adobe data source, similar-image
  search, pricing flow.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** with PRD design tokens (dark navy sidebar, lavender bg)
- Custom Shadcn/UI-style primitives (button, card, input, badge, label, select)
- **NextAuth.js** (email/password + optional Google OAuth)
- **Prisma** ORM with **SQLite** locally (swap to Supabase Postgres for prod)
- Pluggable data-provider layer in `src/lib/providers/`

## Local development (SQLite)

```bash
# 1. Install dependencies
npm install

# 2. Configure env
cp .env.example .env
# (the defaults work for local dev — DATA_PROVIDER=mock by default)

# 3. Set up the database
npx prisma generate
npx prisma db push

# 4. Run the dev server
npm run dev
# -> http://localhost:3000
```

The app redirects `/` to `/search`. Try keywords like `business`, `nature`, or
`ai illustration`. All numbers come from `mockProvider`
(`src/lib/providers/mock.ts`) and are clearly labeled `Demo Data` in the UI.

## Vercel deployment

> **Do not rely on SQLite when deploying to Vercel.** Vercel functions run on
> ephemeral filesystems — a SQLite file there will be lost between requests
> and between deploys. Use a managed Postgres (e.g. Supabase) for any
> deployed environment.

For the full end-to-end walkthrough — creating the Supabase project, grabbing
the pooled connection URL, migrating the Prisma schema, setting Vercel env
vars, running the first `prisma db push`, and the post-deploy QA checklist —
see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

The 30-second version:

1. Create a Supabase project, copy the **pooled** (pgBouncer, port `6543`)
   connection string, and add `?pgbouncer=true&connection_limit=1`.
2. In `prisma/schema.prisma`, switch `provider = "sqlite"` → `"postgresql"`
   on your deploy branch. (Leave `main` on SQLite so local dev stays easy;
   see `DEPLOYMENT.md §5` for the two migration strategies.)
3. Set the env vars listed in [`.env.example`](.env.example) on Vercel,
   especially `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`
   (`openssl rand -base64 32`).
4. Deploy, then run `npx prisma db push` once against the pooled URL.
5. Walk through the QA checklist below.

### Env validation

`src/lib/env.ts` centralizes env handling:

- **Local dev / CI build**: missing `DATABASE_URL` falls back to
  `file:./dev.db` with a warning; missing `NEXTAUTH_SECRET` uses a dev-only
  fallback.
- **Production runtime**: missing `DATABASE_URL`, missing
  `NEXTAUTH_SECRET`, the `.env.example` placeholder, a CI-only secret
  (anything ending `-not-used-at-runtime`), or a secret shorter than
  16 characters all cause the app to **refuse to start** with a descriptive
  error pointing at `docs/DEPLOYMENT.md`.
- `USE_LIVE_SCRAPER` is always forced off in production regardless of the
  env value.

See `docs/DEPLOYMENT.md §10` for what each error message means and how to fix it.

## Manual QA checklist

Run through this after every meaningful PR (and always before promoting a
production deploy). The long-form version with expected outcomes lives in
[`docs/DEPLOYMENT.md §9`](docs/DEPLOYMENT.md#9-post-deploy-qa-checklist).

- [ ] Register a new account (`/auth/register`).
- [ ] Attempt to re-register the same email — friendly duplicate error
      with a working "Go to sign in" link.
- [ ] Sign in with the correct password.
- [ ] Sign in with a wrong password — friendly error with a "Create a new
      account" link.
- [ ] As a guest, hit `/import` — cleanly redirects to
      `/auth/login?callbackUrl=%2Fimport`.
- [ ] On `/import`, click **Download sample CSV** and upload the
      resulting file.
- [ ] Confirm the preview + column mapping appears.
- [ ] Click **Confirm import** — success toast + dataset row appears.
- [ ] Run `/search` for a term that matches imported rows — results now
      carry the `Verified` badge.
- [ ] Save (heart) an asset, confirm it appears in `/saved`.
- [ ] Export a CSV from `/search` — `/export` history reflects it with
      the right data-quality tag and provider name.
- [ ] The "Download again" button on `/export` is visible but disabled
      and labeled **Coming soon**.
- [ ] Archive the dataset from `/import` — `/search` falls back to
      `Demo Data`.
- [ ] No console errors across any page.

## Data providers

Every data-fetching API route goes through a single dispatcher in
[`src/lib/providers/index.ts`](src/lib/providers/index.ts). The provider is
chosen at runtime from `DATA_PROVIDER`:

| Value | Status | What it returns |
| --- | --- | --- |
| `mock` *(default)* | Implemented | Synthetic data tagged `demo`. Used everywhere by default. |
| `official` | **Placeholder** | Throws `ProviderNotImplementedError`. Reserved for a future authoritative Adobe source (official Adobe API or a contributor's own signed export). Tagged `verified` once implemented. |
| `manual` | **Implemented (Phase 3)** | Reads rows from `ImportedDataset` / `ImportedAsset` for the signed-in user. `selectProvider()` auto-promotes signed-in users with non-archived datasets to this provider — no explicit `DATA_PROVIDER=manual` needed. Tagged `verified`. |

If a non-mock provider throws `ProviderNotImplementedError` at call time, the
API routes log a warning and gracefully fall back to `mockProvider`, so the UI
never breaks.

### Why no live scraper?

Live scraping Adobe Stock raises ToS, anti-bot, and accuracy concerns that we
deliberately do **not** want shipped from this codebase. To make that hard to
get wrong:

- There is no scraper code, no proxy rotation, no UA evasion, and no
  private/internal Adobe API access anywhere in this repo.
- `USE_LIVE_SCRAPER=true` is **always ignored in production** — even setting it
  in Vercel env vars cannot enable scraping. In dev it simply logs a warning
  and continues to return mock data.
- The “real” path forward is to plug in `officialAdobeProvider` against an
  authoritative source (official Adobe API or contributor-signed export) and
  emit `dataQuality: "verified"` from there.

### Adding a real provider

1. Create `src/lib/providers/<your-provider>.ts` implementing `DataProvider`.
2. Register it in `PROVIDERS` inside `src/lib/providers/index.ts`.
3. Make sure every method returns a result with the correct `dataQuality` tag.
4. Set `DATA_PROVIDER=<your-provider>` in your environment.

The UI will automatically render the matching badge (`Verified`,
`Public Metadata`, etc.) on every metric.

## Manual data import

The fastest way to get real numbers into the app today is to import them
yourself. From `/import` (sidebar → **Import data**):

1. Sign in (imports are scoped per user).
2. Upload a CSV (max 10 MB).
3. The server parses it and auto-suggests a column mapping based on header
   names (case-insensitive, punctuation-insensitive).
4. Review the preview table — you can override any column → field mapping
   before confirming.
5. Confirm. The dataset is stored in `ImportedDataset` + `ImportedAsset`
   under your user.

Once at least one non-archived dataset exists for the signed-in user,
`selectProvider()` automatically switches that user's requests to
`manualImportProvider` — Search, Dashboard, Portfolio, Heat Map, Trending,
and Export all start serving the user's verified data instead of the demo
fallback. No env-var change required.

### Recognized CSV columns

The mapper looks for any of these (or common synonyms):

```
id, title, downloads, performanceScore, downloadsPerMonth,
contentType, categories, uploadDate, contributorName,
contributorId, keywords, adobeStockUrl, thumbnailUrl,
isPremium, isAiGenerated
```

Any field you omit is left as **unknown**. The app refuses to fabricate
numbers for imported data; if you don't supply `downloads`, you'll see
`0` with no badge upgrade. Two fields the app will compute when possible:

- `performanceScore` and `downloadsPerMonth` — derived from `downloads` +
  `uploadDate` via the formulas in `src/lib/scoring.ts`. Computed values
  carry the `Estimated` tag, not `Verified`.

### Export history

Every CSV download from anywhere in the app inserts a row into
`ExportHistory` for the signed-in user. The `/export` page lists the most
recent 100 exports with the data-quality tag from when they were generated
(so you can tell at a glance which past exports were demo vs verified).

## Dataset selection (Phase 6)

Once a user has imported one or more CSVs they can pick **which dataset
powers every analytics surface**. The selector lives in the top bar and is
visible on every dashboard route (`/search`, `/dashboard`, `/portfolio`,
`/heatmap`, `/trending`, `/export`, `/import`, `/saved`).

There are exactly three scopes:

| Scope | Banner text | Behavior |
| --- | --- | --- |
| **All imported datasets** | "Using all imported datasets" | Queries aggregate across every non-archived dataset the user owns. Default when the user signs in. |
| **Selected dataset** | "Using dataset: &lt;name&gt;" | Scoped to one dataset. Search / Dashboard / Portfolio / Heat Map / Trending / Export all see *only* that dataset's rows. |
| **Demo data** | "Using demo data" | Forces the mock provider even when the user has imported data. Useful for demos / screenshots. |

When the user has **no imported datasets yet**, the banner shows
"No imported data yet" (a UI-only variant of the "demo" state) and offers
a CTA to `/import`.

### Persistence

The selection is persisted per user in `User.activeDatasetId`:

- `NULL` → "All imported datasets" (the default for a new account).
- `"__demo__"` → explicit demo scope.
- any other string → the concrete dataset id.

Scope resolution (`src/lib/dataset-scope.ts`) always re-verifies ownership
and `archived = false` before trusting a specific id. **User isolation is
enforced at every API entry point** — User A can never resolve to User B's
dataset even if they craft a malicious request with that id.

### Archive vs. delete

From the management table on `/import`:

- **Archive** (soft-delete) — the dataset is hidden from search / selector
  but its rows stay in the database. The user can re-import a CSV with
  the same shape to recreate it.
- **Delete** (hard) — permanently removes the dataset and all its
  `ImportedAsset` rows. Irreversible.

In both cases, if the archived/deleted dataset was the user's **active
selection**, the API atomically clears `User.activeDatasetId` in the same
transaction, so the user doesn't get stuck pointing at a ghost. On the
next page load they see the amber "Your selected dataset is no longer
available" warning banner and are implicitly back on "All datasets".

### Rename

Rename is a simple `PATCH /api/import/:id` — it updates `name` only.
Export-history rows that reference the old name still resolve via
`datasetId`, so renaming doesn't break past history.

### Export history carries scope

Every CSV you export records the active scope at the moment of export:

- `all_datasets` — aggregate export
- `selected_dataset` — with the concrete `datasetId` snapshot
- `demo_data` — mock export

The `/export` history table surfaces this as "Dataset: Q3 2025" /
"All imported datasets" / "Demo data", so you can later tell which
historical CSV came from which scope — even after you archive or
rename the dataset.

## Implemented in Phase 1

- Sidebar nav (dark navy), top bar, lavender background, white cards
- Auth: email/password sign-in, registration, sign-out (forgot/reset stubbed)
- Search page: bar, sort/content/AI filters, recent searches (localStorage)
- Result cards: download count, performance score, downloads/month gradient
  cards, AI/Premium badges, expandable keywords with copy, contributor link
- Results summary: total count, competition level, AI saturation, content
  breakdown bar
- Toolbar: select-all, sort by downloads/performance, export selected/all
- CSV export (`POST /api/export`) with full PRD-spec columns
- Favorites: heart toggle on cards, `/saved` page (server-backed when signed
  in, localStorage otherwise)
- Portfolio Tracker: contributor lookup form + overview, content breakdown,
  top keywords, best sellers grid (uses mock contributor)
- Heat Map: tile-sized treemap, opportunity finder, crowded niches
- Trending: keyword + niche lists with growth %
- Dashboard: stat cards + trending + quick actions
- Settings: profile + sign out
- Performance score & competition level utilities (per PRD §10.3 / §10.4)
- Prisma schema for `User`, `Account`, `Session`, `Device`, `SearchHistory`,
  `Favorite`, `CachedAsset`, `CachedSearch`, `ExportHistory` (SQLite-adapted)

## Added in Phase 2

- `DataQuality` type + visible badges on every analytics metric
- Page-level data-quality banner on search, portfolio, heat map, trending,
  dashboard, and saved
- `DataProvider` interface + `mock` / `official` / `manual` implementations
- `selectProvider()` dispatcher with graceful fallback to mock
- Production guardrails: `USE_LIVE_SCRAPER` is ignored in production
- GitHub Actions CI workflow
- Loading skeletons + empty / error states across pages
- Mobile sidebar drawer (hamburger toggle in topbar)
- Vercel deploy + Supabase migration guide
- `.env.example` cleanup with `DATA_PROVIDER` selector

## Added in Phase 3

- `manualImportProvider` reading from new `ImportedDataset` + `ImportedAsset`
  Prisma models
- `/import` page with drag-and-drop CSV upload, server-side parse via
  `papaparse`, header auto-mapping with manual override, preview table,
  validation errors, and dataset list with archive action
- `/api/import/preview`, `/api/import` (POST/GET), `/api/import/:id` (DELETE)
- `selectProvider()` auto-promotes signed-in users with imported data to
  `manualImportProvider`
- Imported data flows into Search, Dashboard, Portfolio, Heat Map, Trending,
  Saved, Export — all carrying the `Verified` badge
- Completed `/export` page with `ExportHistory` table; per-export quality
  + provider tagging on `/api/export`
- Dashboard activity counters & recent searches sourced from `SearchHistory`
  / `Favorite` / `ExportHistory` tables (formerly placeholder zeros)

## Phase 3+ TODO

- `officialAdobeProvider` against an authoritative source (Adobe API or
  contributor-signed export feed)
- Similar image search (upload → reverse search)
- Email-based password reset
- Active dataset selector (today all of a user's datasets are aggregated)
- JSON import (today only CSV is supported)
- Device limit + session management
- Pricing page + Stripe / PayPal / Cryptomus integration (Phase 4 SaaS)

## Folder structure

```
src/
├── app/
│   ├── (auth)/           # Auth pages (login, register, forgot, reset)
│   ├── (dashboard)/      # All sidebar pages (search, dashboard, portfolio, ...)
│   ├── api/              # Route handlers (search, favorites, export, ...)
│   ├── layout.tsx        # Root layout (Providers, fonts)
│   └── page.tsx          # Redirects to /search
├── components/
│   ├── ui/               # Shadcn-style primitives + DataQualityBadge/Banner
│   ├── layout/           # Sidebar (drawer-aware), TopBar, PageHeader
│   ├── search/           # SearchBar, ResultCard, Pagination, ...
│   ├── dashboard/        # StatCard
│   └── providers.tsx     # SessionProvider wrapper
├── hooks/                # use-recent-searches, use-favorites
├── lib/
│   ├── auth.ts           # NextAuth options
│   ├── prisma.ts         # Prisma singleton
│   ├── scoring.ts        # Performance score / competition level
│   ├── csv.ts            # CSV serializer
│   ├── constants.ts      # Sidebar nav, options
│   ├── mock-data.ts      # Generators for search/portfolio/heatmap demos
│   ├── providers/        # Data-provider layer
│   │   ├── types.ts            # DataProvider, ProviderContext, error classes
│   │   ├── mock.ts             # default fallback
│   │   ├── official-adobe.ts   # placeholder (throws + warns)
│   │   ├── manual-import.ts    # real, DB-backed (Phase 3)
│   │   └── index.ts            # selectProvider() + run* helpers
│   ├── import/
│   │   └── csv.ts              # papaparse + column auto-mapping
│   ├── scraper/
│   │   └── adobe-stock.ts # Thin wrapper that delegates to selectProvider()
│   └── utils.ts          # cn(), formatNumber, timeAgo, parseJsonArray
└── types/                # Shared TS types
```

## License

MIT — based on a TAS Tracker-style PRD by hikhikhook.
