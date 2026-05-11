# Production readiness checklist

A short, operator-facing checklist for deploying SN Adobe Analytic to
Vercel with Supabase. For the long-form walkthrough (screenshots,
troubleshooting, rollback) see [`DEPLOYMENT.md`](DEPLOYMENT.md).

> **Source of truth for env vars:** [`.env.example`](../.env.example).
> Every variable below is documented there in detail.

---

## 1. Required env vars (production will refuse to boot without these)

The app **will not start** in `NODE_ENV=production` unless these are set
to real, non-placeholder values. See
[`src/lib/env.ts`](../src/lib/env.ts) for the validation rules.

| Variable | What | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **pooled** (pgBouncer) URL, port `6543`, with `?pgbouncer=true&connection_limit=1` | Supabase → Project Settings → Database → Connection string → **Transaction** |
| `DIRECT_URL` | Supabase **direct** URL, port `5432` (used only by `prisma db push` / `migrate deploy`) | Supabase → Project Settings → Database → Connection string → **Direct** |
| `NEXTAUTH_URL` | Public origin of this deployment, e.g. `https://sn-adobe-analytic.vercel.app` | Vercel → Project → Domains (the primary production domain) |
| `NEXTAUTH_SECRET` | 32+ byte random string — NextAuth session signing key | Generate with `openssl rand -base64 32` |

Runtime guards that will fail the boot (see `src/lib/env.ts`):

- Missing `DATABASE_URL`.
- Missing `NEXTAUTH_SECRET`, the `.env.example` placeholder, anything
  ending `-not-used-at-runtime` (CI marker), or secrets shorter than
  16 characters.

---

## 2. Optional env vars (app runs without them; features degrade cleanly)

| Variable | Feature | Behavior when unset |
| --- | --- | --- |
| `DATA_PROVIDER` | Selects the data source (`mock` / `manual` / `public` / `official`) | Defaults to `mock` (demo data, clearly labeled) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in | Google button renders disabled with "not configured" copy |
| `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` | Client-side Google button enabled flag | Must be `"1"` to enable the button |
| `OWNER_EMAILS` | Owner-role bootstrap on sign-in | Nobody is auto-promoted to owner |
| `OFFICIAL_PROVIDER_BASE_URL` | Public-metadata HTTP boundary | Provider returns empty results with a "not configured" notice |
| `OFFICIAL_PROVIDER_API_KEY` | Bearer token for the HTTP boundary | Sent only if both `BASE_URL` and `API_KEY` are set |
| `PUBLIC_SCRAPER_ENABLED` / `PUBLIC_SCRAPER_ALLOW_PROD` | Built-in public Adobe Stock metadata scraper | Scraper stays off; both are required to enable in production |
| `MAX_IMPORT_FILE_SIZE_MB` | CSV import size cap | Defaults to 10 MB, hard-capped at 100 MB |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase JS client (Storage, RLS) — not needed for Prisma | Prisma reads Postgres via `DATABASE_URL`; these are unused |

---

## 3. Optional / future — payment env vars

> **Status:** The Stripe checkout and webhook routes are implemented
> (see `src/app/api/billing/checkout/route.ts` and
> `src/app/api/billing/webhook/route.ts`) but the **end-to-end payment
> flow has not been verified against a live Stripe account from this
> deployment**. Treat these env vars as *optional and deferred* until
> you've completed a full test checkout against your Stripe account.
>
> When unset, `/pricing` still renders; clicking **Upgrade** returns a
> clean `503 stripe_not_configured` response rather than faking a
> payment success. Owner accounts bypass plan gates regardless of
> billing state, so you can run production with no Stripe config at
> all while payment is still being validated.

| Variable | What |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe server secret key (starts with `sk_live_` / `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for `/api/billing/webhook` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-visible publishable key |
| `STRIPE_STARTER_PRICE_ID_USD` / `..._IDR` | Price ID for the Starter plan × currency |
| `STRIPE_PRO_PRICE_ID_USD` / `..._IDR` | Price ID for the Pro plan × currency |
| `STRIPE_ANNUAL_PRICE_ID_USD` / `..._IDR` | Price ID for the Annual plan × currency |
| `NEXT_PUBLIC_USD_TO_IDR_RATE` | Display-only conversion rate on `/pricing` (default `16000`) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal (not yet implemented — UI says "coming soon") |

Checkout gracefully reports the exact missing piece:

- `STRIPE_SECRET_KEY` missing → 503 `stripe_not_configured`
- Price ID for the chosen plan × currency missing → 503
  `price_not_configured` with the plan + currency in the body
- Webhook without `STRIPE_WEBHOOK_SECRET` → 500 `webhook_not_configured`
  (log-only; Stripe will retry)

---

## 4. Google OAuth redirect URI (only if you use Google sign-in)

Enabling Google sign-in requires three env vars **plus** registering the
exact callback URL with Google Cloud Console.

In the Google Cloud Console
([console.cloud.google.com](https://console.cloud.google.com)) → APIs &
Services → Credentials → your OAuth 2.0 Client ID → **Authorized
redirect URIs**, add:

```
https://<your-production-domain>/api/auth/callback/google
```

Also add the Vercel preview pattern if you want sign-in to work on
preview deploys — each preview deploy has a unique subdomain so you'll
need either a wildcard mechanism or add specific preview URLs as needed.

Then set:

```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1
```

All three must be set together. Leaving any of them blank keeps the
Google button visible but disabled with "not configured for this
deployment" copy. This is the PRD's "graceful disable" pattern — the
UI never silently hides the option, so the deployment state stays
obvious.

---

## 5. First-deploy database setup

1. Provision the Supabase project ([`DEPLOYMENT.md §3`](DEPLOYMENT.md#3-create-a-supabase-project)).
2. Copy the **pooled** and **direct** connection strings
   ([§4](DEPLOYMENT.md#4-get-the-pooled--direct-connection-strings)).
3. Set `DATABASE_URL` + `DIRECT_URL` + `NEXTAUTH_URL` +
   `NEXTAUTH_SECRET` in Vercel → Settings → Environment Variables
   (check **Production**, **Preview**, and **Development** as needed).
4. Push the branch to Vercel → first deploy builds successfully against
   an empty DB.
5. **From your laptop**, with both env vars exported, run:

   ```bash
   export DATABASE_URL='<pooled URL with ?pgbouncer=true&connection_limit=1>'
   export DIRECT_URL='<direct URL>'
   npx prisma db push
   ```

6. Verify the tables exist in Supabase → Table editor. You should see
   `User`, `Account`, `Session`, `Favorite`, `Collection`, …

---

## 6. Post-deploy sanity check (takes ~2 minutes)

Open two browser sessions — one Incognito, one with a normal profile
you'll sign in with.

### Incognito (guest)

- [ ] `GET /` → redirects to `/auth/login`.
- [ ] `GET /search` → redirects to
      `/auth/login?callbackUrl=%2Fsearch`.
- [ ] `GET /dashboard` → redirects to
      `/auth/login?callbackUrl=%2Fdashboard`.
- [ ] `GET /api/search/trending` → `401 {"error":"unauthenticated", ...}`.
- [ ] `GET /pricing` → renders the plan grid with **Sign in to
      upgrade** on each paid tier.
- [ ] `GET /api/user/entitlements` → `200 {"signedIn":false, ...}`.

### Signed-in (a real account)

- [ ] Sign-in with the correct password lands on `/dashboard`.
- [ ] `GET /` as a signed-in user → redirects to `/dashboard`.
- [ ] Sign-in returning from `?callbackUrl=%2Fsearch` lands on `/search`
      (not `/dashboard`).
- [ ] Dashboard banner reads either "Using all imported datasets",
      "Using dataset: <name>", "Demo mode active", or
      "No data source configured" (with an "Import your CSV" CTA).
- [ ] `/import` → can download the sample CSV and upload it.
- [ ] `/search?q=<anything>` renders without console errors.
- [ ] `/settings` → **Data Sources** card shows each provider's
      configured/available state.

### Owner account (only if `OWNER_EMAILS` contains your email)

- [ ] Sign in once to trigger the env bootstrap
      (`src/lib/owner-bootstrap.ts`).
- [ ] `/settings` shows the "Owner access" badge and
      "Source: env bootstrap" metadata.
- [ ] `GET /api/admin/config-status` → `200` with booleans for
      every env var group (no secret values echoed).

---

## 7. What happens when env is misconfigured

The app is designed to fail loudly on the server and show clear
user-facing copy on the client, rather than silently looking broken.

| Condition | Server behavior | User-facing behavior |
| --- | --- | --- |
| Missing `DATABASE_URL` in production | Boot throws with a pointer to `DEPLOYMENT.md` | Vercel deployment fails — nobody reaches the app |
| `NEXTAUTH_SECRET` is the `.env.example` placeholder | Boot throws | Vercel deployment fails |
| Missing `NEXTAUTH_URL` | Warns in logs; OAuth callbacks use the request host | Usually fine; Google OAuth may return to wrong origin in edge cases |
| `DATA_PROVIDER` set but provider not configured | `official` provider returns empty + notice | "Public Adobe Stock metadata — not configured" banner on analytics pages |
| No imported data, not demo mode | API returns honest empty envelope with `noDataConfigured: true` | `NoDataState` with three CTAs (Import CSV / Configure public metadata / Try demo mode) |
| Stripe missing when user clicks Upgrade | 503 `stripe_not_configured` | Pricing page shows "Payment processing is not configured" |
| Google env partially set | Boot succeeds; Google button stays disabled | "Google sign-in is not configured for this deployment" |

No configuration state ever produces silent mock data for a signed-in
production user without an explicit "demo mode" opt-in (PR #23
guarantee).

---

## 8. Where to look when something goes wrong

| Symptom | First place to look |
| --- | --- |
| Vercel build fails on `next build` | Build logs → usually a missing env var |
| App boots but `/api/*` all return 500 | Function logs → look for `[env]` or `PrismaClientInitialization` errors |
| Sign-in redirects loop | Middleware logs (`x-sn-auth-gate` response header) + session cookie domain |
| "prepared statement already exists" errors | `DATABASE_URL` is missing `?pgbouncer=true` — see `DEPLOYMENT.md §10` |
| Dashboard shows mock data for a real user who has imports | Active dataset selector is set to "Demo data" — check top bar |
| `POST /api/billing/checkout` returns 503 | Expected when Stripe isn't configured; see §3 above |

Full troubleshooting table: [`DEPLOYMENT.md §10`](DEPLOYMENT.md#10-troubleshooting).
