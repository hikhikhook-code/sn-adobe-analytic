# Deployment guide — Vercel + Supabase (Postgres)

This is the step-by-step guide for deploying SN Adobe Analytic to Vercel with
a Supabase Postgres database. Local development continues to work against
SQLite — nothing in this guide affects your `dev.db`.

> **You do not need a Supabase account to run this project locally.** The
> default `DATABASE_URL=file:./dev.db` in `.env.example` is enough for
> `npm run dev`. Follow this guide only when you're ready to deploy to a
> shared environment.

## Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Create a Supabase project](#3-create-a-supabase-project)
4. [Get the pooled connection string](#4-get-the-pooled-connection-string)
5. [Migrate `prisma/schema.prisma` from SQLite to Postgres](#5-migrate-prismaschemaprisma-from-sqlite-to-postgres)
6. [Environment variables reference](#6-environment-variables-reference)
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
  Vercel's ephemeral serverless functions.
- **Auth**: NextAuth.js (JWT strategy, no external session store required).
- **Static assets**: served from the `/public` folder as usual.

The repo's CI (`.github/workflows/ci.yml`) runs against SQLite, so CI stays
green without a Supabase account or network access to Postgres.

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

## 4. Get the pooled connection string

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

4. Optionally grab the **direct** (`:5432`) connection string too — you'll
   need it *only* when running `prisma migrate deploy` (DDL operations
   don't work through the transaction pooler).

## 5. Migrate `prisma/schema.prisma` from SQLite to Postgres

The local SQLite schema stores a few `String[]` fields as JSON-encoded
strings because SQLite has no native array type. Postgres supports arrays
natively, and switching lets you use Prisma's `has`, `hasEvery`, and
`hasSome` filters.

**You have two options:**

### Option A — Keep it simple (recommended for the first deploy)

Change only the provider, leave `*Json` columns as-is. This lets you deploy
in minutes without touching any API route.

1. In `prisma/schema.prisma`, change:

   ```prisma
   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

   to:

   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. Commit the schema change on a deploy branch (e.g.
   `chore/postgres-schema`). Do **not** merge it back to `main` if you
   want `main` to continue targeting SQLite for local dev — instead, keep
   this branch long-lived as your production branch, or use Prisma's
   multi-schema tooling. The README's "Local development" section already
   assumes `sqlite`.

### Option B — Native arrays (recommended eventually)

Convert the JSON-encoded fields to native `String[]`. This is a larger
change because several routes parse those JSON strings manually.

1. In `prisma/schema.prisma`, alongside the provider change, replace:

   ```prisma
   keywordsJson    String  @default("[]")
   categoriesJson  String  @default("[]")
   resultIdsJson   String  @default("[]")
   fieldQualityJson String @default("{}")  // stays a String — it's a map
   paramsJson      String  @default("{}")  // stays a String — it's a map
   ```

   with:

   ```prisma
   keywords        String[] @default([])
   categories      String[] @default([])
   resultIds       String[] @default([])
   // fieldQualityJson and paramsJson are objects, not arrays — leave them
   // as JSON-encoded strings OR switch them to Prisma's Json type. Either
   // works; Json is cleaner but requires code changes.
   ```

2. Update consumers:
   - `src/app/api/favorites/route.ts` — stops calling `parseJsonArray`
     on the field, reads the array directly.
   - `src/lib/providers/manual-import.ts` — same; `categoriesJson` and
     `keywordsJson` stop being JSON-encoded.
   - `src/lib/utils.ts` — `parseJsonArray` can be deleted if nothing else
     uses it.
3. Regenerate and deploy as in Option A.

**Why not do Option B on day one?** It touches runtime code, which expands
the blast radius of your first Postgres deploy. Ship Option A first, verify
the app works, then ship Option B as a follow-up PR.

## 6. Environment variables reference

Set these in **Vercel → Settings → Environment Variables**. Mark them as
available for *Production*, *Preview*, and *Development* as appropriate.

| Variable | Required | Example / notes |
| --- | --- | --- |
| `DATABASE_URL` | yes (prod) | Supabase pooled URL from [§4](#4-get-the-pooled-connection-string). In dev, defaults to `file:./dev.db`. |
| `NEXTAUTH_URL` | yes | `https://<your-app>.vercel.app` for production; set to the preview URL for preview environments. |
| `NEXTAUTH_SECRET` | yes | Generate with `openssl rand -base64 32`. Must be a real random string — the app **will refuse to start** at runtime if it detects the `.env.example` placeholder, a CI-only value, or anything shorter than 16 chars. |
| `DATA_PROVIDER` | no | `mock` (default), `official`, or `manual`. Non-mock providers currently fall back to mock until implemented. |
| `MAX_IMPORT_FILE_SIZE_MB` | no | Default `10`. Cap on a single `/import` CSV upload. Hard-capped at 100 in `src/lib/env.ts` regardless of what you set. |
| `USE_LIVE_SCRAPER` | no | Always ignored in production. Leave unset. |
| `GOOGLE_CLIENT_ID` | optional | Only if you want Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | optional | Only if you want Google sign-in. |

All validation rules live in [`src/lib/env.ts`](../src/lib/env.ts).

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
# 1. Pin the same env the Vercel build is using.
export DATABASE_URL='postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'

# 2. Create the initial migration and push it.
#    `db push` is fine for the very first deploy because the database
#    is empty; switch to `prisma migrate deploy` once you start shipping
#    schema changes.
npx prisma db push
```

Alternatively, if you already have `prisma/migrations/` files, use
`npx prisma migrate deploy` against the **direct** (`:5432`) connection
string — DDL does not flow through pgBouncer reliably.

Verify the tables exist in Supabase → **Table editor**.

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
  the pooled URL after switching providers. Re-run it from your laptop
  with the `DATABASE_URL` env var set. See [§8](#8-first-deploy-database-setup).

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
