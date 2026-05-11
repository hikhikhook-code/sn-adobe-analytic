# Deployment guide — Vercel + Supabase (Postgres)

This is the step-by-step guide for deploying SN Adobe Analytic to Vercel with
a Supabase Postgres database.

> **Looking for the short version?** See
> [`PRODUCTION-CHECKLIST.md`](PRODUCTION-CHECKLIST.md) for the 1-page
> operator checklist (required vs optional env vars, Google OAuth
> redirect URI, post-deploy QA, troubleshooting index).

> As of **PR #27** the Prisma schema targets PostgreSQL exclusively — SQLite
> is no longer supported. Local development also runs against Postgres
> (Docker, Homebrew, Postgres.app, or a free Supabase project). See the
> [README Local development](../README.md#local-development) section for
> the one-time local setup.

---

## TL;DR — Required vs optional env vars

For the full reference table see [§6](#6-environment-variables-reference).

**Required at production runtime** — app refuses to boot without these:

- `DATABASE_URL` — Supabase pooled connection (port `6543`, with
  `?pgbouncer=true&connection_limit=1`)
- `DIRECT_URL` — Supabase direct connection (port `5432`, for Prisma DDL)
- `NEXTAUTH_URL` — public origin, e.g. `https://<app>.vercel.app`
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`, at least 16 chars, not
  a placeholder

**Optional** — app runs fine without them; the feature degrades to a
clearly-labeled "not configured" state:

- `DATA_PROVIDER`, `OFFICIAL_PROVIDER_BASE_URL`,
  `OFFICIAL_PROVIDER_API_KEY`
- `PUBLIC_SCRAPER_ENABLED`, `PUBLIC_SCRAPER_ALLOW_PROD`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` — see [§6.1](#61-google-oauth-redirect-uri)
- `OWNER_EMAILS`, `MAX_IMPORT_FILE_SIZE_MB`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (only if you use the Supabase JS client
  directly — Prisma does not need them)

**Optional / future** — payment integration. Implemented in the repo
but **not yet end-to-end verified against a live Stripe account from
the current deployment** (see [§6.2](#62-payment-env-vars-optional--deferred)):

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_*_PRICE_ID_USD`, `STRIPE_*_PRICE_ID_IDR`
- `NEXT_PUBLIC_USD_TO_IDR_RATE`
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (UI says "coming soon";
  no server implementation yet)

## Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Create a Supabase project](#3-create-a-supabase-project)
4. [Get the pooled + direct connection strings](#4-get-the-pooled--direct-connection-strings)
5. [Prisma schema (Postgres-first)](#5-prisma-schema-postgres-first)
6. [Environment variables reference](#6-environment-variables-reference)
   - [6.1 Google OAuth redirect URI](#61-google-oauth-redirect-uri)
   - [6.2 Payment env vars — optional / deferred](#62-payment-env-vars--optional--deferred)
7. [Create the Vercel project](#7-create-the-vercel-project)
8. [First-deploy database setup](#8-first-deploy-database-setup)
9. [Post-deploy QA checklist](#9-post-deploy-qa-checklist)
10. [Troubleshooting](#10-troubleshooting)
11. [Rolling back](#11-rolling-back)

---

## 1. Overview

The app is a Next.js 14 App Router project with Prisma + NextAuth. The
deployment target is:

- **Hosting**: Vercel (Edge network + serverless functions)
- **Database**: Supabase Postgres accessed via the **pooled** (pgBouncer)
  connection URL. A direct (`:5432`) connection does not work reliably with
  Vercel's ephemeral serverless functions at request time; we also keep the
  direct URL wired up (`DIRECT_URL`) so Prisma DDL (`db push` /
  `migrate deploy`) can run.
- **Auth**: NextAuth.js (JWT strategy, no external session store required).
- **Static assets**: served from the `/public` folder as usual.

CI (`.github/workflows/ci.yml`) runs `prisma generate` + `next build`
against a placeholder Postgres URL
(`postgresql://postgres:postgres@localhost:5432/sn_adobe_analytic_ci?schema=public`).
The URL is only validated for format — nothing in the build path opens a
connection to the database — so CI stays green without a Supabase account
or any real credentials.

## 2. Prerequisites

- A GitHub account with this repo forked or accessible.
- A [Supabase](https://supabase.com) account (free tier is fine).
- A [Vercel](https://vercel.com) account connected to the same GitHub org
  or user.
- Local Node.js 20+ and npm (only needed if you want to run migrations from
  your laptop instead of Vercel's build).
- An `openssl` binary (macOS / Linux / WSL) for generating a secret.

## 3. Create a Supabase project

1. Go to [app.supabase.com](https://app.supabase.com) → **New project**.
2. Name it (e.g. `sn-adobe-analytic-prod`), pick a region close to your
   Vercel region, and set a strong **database password**. Save the password
   somewhere you can retrieve later — Supabase shows it only once.
3. Wait ~1 minute for the project to provision.

## 4. Get the pooled + direct connection strings

Supabase exposes two connection endpoints you'll use:

- **Pooled** (pgBouncer, port `6543`) — for the app at request time
  (`DATABASE_URL`).
- **Direct** (port `5432`) — for Prisma DDL only
  (`DIRECT_URL`, used by `prisma db push` / `prisma migrate deploy`).
  pgBouncer's transaction pooler does not support prepared statements
  reliably enough for DDL.

### Pooled URL (DATABASE_URL)

1. In the Supabase dashboard: **Project Settings → Database → Connection
   string**.
2. Switch the tab to **URI** and then to **Transaction** (or whichever tab
   is labeled *connection pooler* / *pgbouncer*). The value looks like:

   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

3. Append pooler-friendly query params for Prisma on serverless:

   ```
   ?pgbouncer=true&connection_limit=1
   ```

   Final shape:

   ```
   postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
   ```

   - `pgbouncer=true` tells Prisma to skip prepared statements that don't
     work with pgBouncer's transaction pooler.
   - `connection_limit=1` avoids each cold serverless function opening its
     own pool; Vercel functions are short-lived and we want the pool to
     live in the pooler, not the function.

### Direct URL (DIRECT_URL)

Same panel, **Direct connection** tab (port `5432`):

```
postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Do **not** append `pgbouncer=true` here. This URL is only used by the
Prisma CLI to run DDL against the database.

Store both strings in a password manager — Supabase won't show the DB
password again.

## 5. Prisma schema (Postgres-first)

As of PR #27, `prisma/schema.prisma` already targets PostgreSQL — no
schema change is required to deploy. Concretely:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

All existing models are compatible unchanged:

- `User`, `Account`, `Session`, `VerificationToken`, `PasswordResetToken`,
  `Device` (auth + device management)
- `Favorite`, `Collection`, `SavedSearch` (user library)
- `SearchHistory`, `ExportHistory` (activity)
- `ImportedDataset`, `ImportedAsset` (manual CSV imports)
- `CachedSearch`, `CachedAsset`, `CachedContributor` (public-metadata cache)
- `User.role`, `User.ownerAccessGrantedAt`, `User.ownerAccessSource`
  (owner / admin access — PR #18)
- `User.plan` (payment plan field — PR #17 / #26)

The columns that previously worked around SQLite's lack of array support
(`keywordsJson`, `categoriesJson`, `paramsJson`, `fieldQualityJson`) still
store JSON-encoded strings. They continue to work on Postgres and every
call site that reads/writes them stays unchanged. A follow-up PR can
convert them to native `String[]` / `Json` one at a time if we want
Prisma's array operators — that's explicitly out of scope for PR #27.

### (Optional, future) — convert to native Postgres arrays

If a later PR wants to take advantage of Postgres-native arrays for
`has`, `hasEvery`, `hasSome` filters, replace the affected columns:

```prisma
keywordsJson    String  @default("[]")  // -> keywords   String[] @default([])
categoriesJson  String  @default("[]")  // -> categories String[] @default([])
// paramsJson / fieldQualityJson are objects, not arrays — leave them as
// Strings OR switch to Prisma's `Json` type. Either works.
```

and update the small number of consumers that parse those JSON strings
(`src/lib/utils.ts:parseJsonArray`, `src/lib/providers/manual-import.ts`,
`src/app/api/favorites/route.ts`, `src/app/api/saved/export/route.ts`,
`src/app/api/dashboard/route.ts`, `src/lib/import/csv.ts`). This is a
pure optimization / ergonomics change and is not required for production.

## 6. Environment variables reference

Set these in **Vercel → Settings → Environment Variables**. Mark them as
available for *Production*, *Preview*, and *Development* as appropriate.

| Variable | Required | Example / notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase pooled URL (port `6543`) from [§4](#4-get-the-pooled--direct-connection-strings), with `?pgbouncer=true&connection_limit=1`. In local dev, point at your local Postgres. The app **refuses to start** in production if this is unset. |
| `DIRECT_URL` | yes (for `prisma db push` / `migrate deploy`) | Supabase direct URL (port `5432`). Used only by the Prisma CLI for DDL. In local dev, same as `DATABASE_URL`. |
| `NEXTAUTH_URL` | yes | `https://<your-app>.vercel.app` for production; set to the preview URL for preview environments. |
| `NEXTAUTH_SECRET` | yes | Generate with `openssl rand -base64 32`. Must be a real random string — the app **will refuse to start** at runtime if it detects the `.env.example` placeholder, a CI-only value, or anything shorter than 16 chars. |
| `DATA_PROVIDER` | no | `mock` (default), `official`, `public`, or `manual`. `public` is the preferred alias for `official` (PR #22). |
| `MAX_IMPORT_FILE_SIZE_MB` | no | Default `10`. Cap on a single `/import` CSV upload. Hard-capped at 100 in `src/lib/env.ts` regardless of what you set. |
| `USE_LIVE_SCRAPER` | no | Always ignored in production. Leave unset. |
| `PUBLIC_SCRAPER_ENABLED` | no | `true` to enable the built-in public metadata scraper (PR #22). Off by default. |
| `PUBLIC_SCRAPER_ALLOW_PROD` | no | Double opt-in for the scraper in production. Required alongside `PUBLIC_SCRAPER_ENABLED=true` when `NODE_ENV=production`. |
| `OWNER_EMAILS` | no | Comma-separated list for owner-bootstrap (PR #18). Never ship real emails in `.env.example`. |
| `GOOGLE_CLIENT_ID` | optional | Only if you want Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | optional | Only if you want Google sign-in. |
| `STRIPE_SECRET_KEY` | optional | PR #26 payment foundation. Missing → checkout returns a 503 "not configured". |
| `STRIPE_WEBHOOK_SECRET` | optional | Verifies Stripe webhook signatures. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Client-side Stripe key. |
| `STRIPE_*_PRICE_ID_USD` / `..._IDR` | optional | Per-plan × currency Stripe Price IDs. |
| `NEXT_PUBLIC_USD_TO_IDR_RATE` | optional | Static display-only rate on `/pricing`. Default `16000`. |
| `NEXT_PUBLIC_SUPABASE_URL` | optional | Only if you use `@supabase/supabase-js` directly (Storage, RLS, etc.). Prisma does not need this. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optional | Same — only for the JS client. |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | Server-only Supabase key for admin operations via the JS client. Never prefix with `NEXT_PUBLIC_`. |

All validation rules live in [`src/lib/env.ts`](../src/lib/env.ts).

### 6.1 Google OAuth redirect URI

Only applies if you want "Continue with Google" on the auth pages. The
Google button is rendered on every build but stays disabled (with
"not configured for this deployment" copy) unless all three of these
are set in Vercel env:

```
GOOGLE_CLIENT_ID        = <from Google Cloud Console>
GOOGLE_CLIENT_SECRET    = <from Google Cloud Console>
NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = 1
```

Missing any of them keeps the button visible but disabled. This is the
PRD's "graceful disable" pattern — the UI never silently removes the
option, so the deployment state stays obvious to the operator.

**In the Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):

1. APIs & Services → Credentials → pick (or create) an OAuth 2.0
   Client ID of type *Web application*.
2. Under **Authorized redirect URIs**, add the exact callback URL that
   NextAuth will hit for this deployment:

   ```
   https://<your-production-domain>/api/auth/callback/google
   ```

   For preview deploys, you'll either need to add each preview URL
   individually or skip Google sign-in on previews (recommended —
   credentials sign-in still works).

3. Copy the **Client ID** and **Client secret** into Vercel env vars.

**Common misconfigurations:**

| Symptom | Fix |
| --- | --- |
| "Error 400: redirect_uri_mismatch" on Google's page | Add the exact callback URL (see above) to the Google Cloud Console client config |
| Google button stays disabled in production | Check `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1` is set — client-visible env var, needs a redeploy after changing |
| Google succeeds but lands on the wrong origin | `NEXTAUTH_URL` is missing or points at the wrong domain — it must match the origin registered with Google |

### 6.2 Payment env vars — optional / deferred

> **Status:** The Stripe checkout and webhook routes are implemented
> ([`src/app/api/billing/checkout/route.ts`](../src/app/api/billing/checkout/route.ts),
> [`src/app/api/billing/webhook/route.ts`](../src/app/api/billing/webhook/route.ts))
> but **the end-to-end payment flow has not been verified against a
> live Stripe account from this deployment**. Treat these env vars as
> optional and defer until you have:
>
> 1. Completed a real test checkout using a Stripe test key and a test
>    card, and confirmed the webhook promotes the user's plan in the
>    `User` table.
> 2. Repeated step 1 with a live key on a real bank card you can
>    refund, and kept a plain-English note of exactly what cleared.
>
> Until then, marketing copy should say "upgrade coming soon" rather
> than imply paid plans are live.

The implementation does the right thing when env is missing:

| Scenario | Behavior |
| --- | --- |
| `STRIPE_SECRET_KEY` not set + user clicks **Upgrade** | `POST /api/billing/checkout` returns 503 `stripe_not_configured`; pricing page surfaces "Payment processing is not configured" |
| Price ID missing for the requested plan × currency | 503 `price_not_configured` with the plan + currency echoed in the body |
| `STRIPE_WEBHOOK_SECRET` not set + Stripe posts to `/api/billing/webhook` | 500 `webhook_not_configured` in logs; Stripe will retry |
| Webhook signature mismatch | 400 `invalid_signature` — refuses to touch the DB |
| Plan is successfully updated from a webhook | Never overwrites `OWNER` / `ADMIN` roles (the `updateMany` is gated on `role: "USER"`) |

Owner accounts bypass plan gates regardless of Stripe state, so you
can run production without any Stripe env vars at all while the
payment flow is still being validated.

Stripe Price ID variables (only needed once you're ready to verify
checkout):

```
STRIPE_STARTER_PRICE_ID_USD=""
STRIPE_PRO_PRICE_ID_USD=""
STRIPE_ANNUAL_PRICE_ID_USD=""
# Separate Prices in IDR currency — don't reuse USD ones
STRIPE_STARTER_PRICE_ID_IDR=""
STRIPE_PRO_PRICE_ID_IDR=""
STRIPE_ANNUAL_PRICE_ID_IDR=""
```

PayPal env vars (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) are
reserved for a future PR — no server-side PayPal implementation
exists today; the `/pricing` page shows "PayPal: Coming soon".

## 7. Create the Vercel project

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** →
   select this repo.
2. **Framework preset**: Next.js (auto-detected).
3. **Build command**: leave as default (`npm run build`) — the repo's
   `npm run build` runs `prisma generate` first, so the generated client
   is always up to date with your deployed schema.
4. **Install command**: `npm ci` (default).
5. Add the environment variables from [§6](#6-environment-variables-reference).
6. Click **Deploy**.

The first deploy builds without a database: `prisma generate` reads from
the schema file, `next build` doesn't hit the DB. The build will succeed
even if your Supabase project is still empty.

## 8. First-deploy database setup

After the first Vercel deploy succeeds, Supabase still has zero tables. You
need to apply the Prisma schema once.

**From your laptop** (simpler, recommended for the first time):

```bash
# 1. Export BOTH env vars. Prisma DDL flows through the DIRECT_URL;
#    pgBouncer doesn't support prepared statements reliably enough for it.
export DATABASE_URL='postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
export DIRECT_URL='postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres'

# 2. Create the tables. `db push` is fine for the very first deploy
#    because the database is empty; switch to `prisma migrate deploy`
#    once you start shipping schema changes.
npx prisma db push
```

If you already have `prisma/migrations/` files, use
`npx prisma migrate deploy` instead — it also reads `DIRECT_URL` for DDL.

Verify the tables exist in Supabase → **Table editor**. You should see
`User`, `Account`, `Session`, `Favorite`, `Collection`, `SavedSearch`,
`ImportedDataset`, `ImportedAsset`, `SearchHistory`, `ExportHistory`,
`CachedSearch`, `CachedAsset`, `CachedContributor`, `Device`,
`VerificationToken`, `PasswordResetToken`.

## 9. Post-deploy QA checklist

Run through this after every production deploy. Each step maps to a feature
phase (Phase 1 = auth/search, Phase 2 = providers/CI, Phase 3 = import/export).

### 9.1 Smoke test

- [ ] `https://<your-app>.vercel.app/` loads (redirects to `/search`).
- [ ] No 500 errors in the Vercel deployment logs.
- [ ] The browser console is free of hydration / SessionProvider errors.

### 9.2 Auth (Phase 1)

- [ ] `/auth/register`: can create a new account.
- [ ] Re-registering the same email shows "That email is already registered.
      Try signing in instead." with a working "Go to sign in" link.
- [ ] `/auth/login`: wrong password shows "That email and password don't
      match an account…" with a "Create a new account" link.
- [ ] After sign-in, `/dashboard` loads.
- [ ] Hitting `/import` as a guest redirects cleanly to
      `/auth/login?callbackUrl=%2Fimport`.
- [ ] Sign-out returns to `/auth/login`.

### 9.3 Search + saved (Phase 1)

- [ ] `/search` returns mock data with a visible `Demo Data` badge.
- [ ] Heart/unheart an asset; `/saved` reflects the change after reload.
- [ ] Recent searches appear on `/dashboard`.

### 9.4 Import (Phase 3)

- [ ] On `/import`, click **Download sample CSV** and the browser downloads
      `adobe-stock-sample.csv` from `/samples/…`.
- [ ] Drag the sample CSV over the drop zone — the border turns blue.
- [ ] Drop the CSV — the preview table appears with 12 rows and 15 columns.
- [ ] The auto-mapping suggests a field for every column.
- [ ] Click **Confirm import** — a green success toast appears; the dataset
      shows up in the "Your imported datasets" table.
- [ ] Try uploading an empty `.txt` file — error reads "Only .csv files are
      supported…" without crashing.
- [ ] Try a file > 10 MB (or whatever your `MAX_IMPORT_FILE_SIZE_MB` is) —
      error mentions the limit in MB.

### 9.5 Search after import (Phase 3 → Phase 1 integration)

- [ ] Without signing out, run a `/search` for "coffee" (or another term
      from the sample CSV). Results now carry `Verified` badges (because
      `selectProvider` auto-promotes to `manualImportProvider`).
- [ ] `/dashboard` stat cards reflect the imported dataset's asset counts.

### 9.6 Export (Phase 3)

- [ ] From `/search`, click **Export** on a non-empty result set — a CSV
      downloads.
- [ ] `/export` history table shows that row with the correct type,
      provider, and data-quality badge.
- [ ] The "Download again" button is visible, **disabled**, with a
      "Coming soon" label underneath.

### 9.7 Archive + rollback (Phase 3)

- [ ] Archive the dataset from `/import` — the row disappears, and
      `/search` reverts to `Demo Data`.

## 10. Troubleshooting

**`PrismaClientInitializationError: Can't reach database server`**
- Confirm `DATABASE_URL` in Vercel env is the pooled (port `6543`) URL
  with `pgbouncer=true&connection_limit=1`.
- In Supabase, check that your project isn't paused (free tier pauses
  after 7 days of inactivity).

**`Error: [env] NEXTAUTH_SECRET is required in production`**
- You left `NEXTAUTH_SECRET` unset (or at the `.env.example` placeholder)
  in Vercel env vars. Generate a real one: `openssl rand -base64 32`.

**`Error: [env] NEXTAUTH_SECRET appears to be a build-only placeholder`**
- Your Vercel env has the CI value `ci-build-secret-not-used-at-runtime`
  (or anything ending `-not-used-at-runtime`). That string is only meant
  for `next build` in CI. Replace it with a real secret.

**`prisma.importedDataset is undefined` / missing tables at runtime**
- `npx prisma db push` (or `prisma migrate deploy`) was never run against
  the direct URL after provisioning Supabase. Re-run it from your laptop
  with both `DATABASE_URL` and `DIRECT_URL` env vars set. See [§8](#8-first-deploy-database-setup).

**`Error: Environment variable not found: DIRECT_URL`**
- Your `.env` / Vercel env is missing `DIRECT_URL`. The app does not need
  it at request time, but `prisma db push` / `prisma migrate deploy` / the
  Prisma client initialization read the `datasource { directUrl = ... }`
  block at schema-parse time. In production, set `DIRECT_URL` to the
  Supabase direct connection string (port `5432`). In local dev, it can
  be identical to `DATABASE_URL`.

**Imported CSV shows zero rows on `/search`**
- Confirm the dataset is `archived: false` (visible on `/import`).
- Confirm at least one column was mapped before you clicked **Confirm
  import** (mapping all columns to "— Skip —" produces zero usable rows,
  which now surfaces `empty_mapping`).

**"prepared statement already exists" / `25P02`**
- pgBouncer transaction pooler doesn't tolerate prepared statements.
  You forgot `?pgbouncer=true` on the URL. Fix the env var and redeploy.

## 11. Rolling back

Vercel keeps every deployment as a named revision. To roll back:

1. Vercel → **Deployments** → select the previous healthy deploy →
   **Promote to Production**.
2. **Don't** roll back Prisma migrations blindly — if the previous deploy
   expected an older schema, you'll need to either:
   - Reset the Supabase database and re-push the older schema (destructive
     — loses user data), or
   - Keep the newer schema and re-deploy a patch that handles both.

For non-destructive rollbacks, prefer fixing forward.

---

For local setup and the data-quality rationale, see the top-level
[README](../README.md).
