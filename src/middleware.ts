/**
 * Edge middleware — authentication gate for the deployed app.
 *
 * PR #28: after the Vercel deploy went live, Incognito visitors hitting
 * the deployed URL were sent straight to `/search` (the old default
 * root redirect) and landed on a working mock-data dashboard without
 * ever logging in. For a SaaS we don't want the demo to be the default
 * for anonymous production traffic — the product should present a
 * landing / login and only open up once the user has a session.
 *
 * What this middleware enforces:
 *
 *   1. **Public** routes always reachable without a session:
 *        - NextAuth pages under `/auth/*` (login, register,
 *          forgot-password, reset-password, device-limit).
 *        - `/pricing` — plan comparison is a marketing page.
 *        - `/billing/success` and `/billing/cancel` — Stripe redirect
 *          targets; these are viewed AFTER a checkout, but the page
 *          itself doesn't need a session to render an informational
 *          card (it doesn't mutate plan state; the webhook does that).
 *        - `/api/auth/*` — NextAuth's own endpoints (csrf, signin,
 *          callback, etc). Locking these would break login itself.
 *        - `/api/billing/webhook` — Stripe posts here with its own
 *          signature-based auth; a cookie check would reject every
 *          legitimate webhook delivery.
 *        - `_next/*`, favicons, static assets, and the sample CSV
 *          shipped under `/samples/*`.
 *
 *   2. **Everything else** requires a signed-in session. That covers
 *      the full dashboard surface:
 *        `/`, `/dashboard`, `/search`, `/portfolio`, `/heatmap`,
 *        `/trending`, `/saved`, `/import`, `/export`, `/settings`,
 *        `/admin`, plus any API route under `/api/*` that isn't in
 *        the allow-list above.
 *
 *   3. **Unauthenticated** requests to protected routes redirect to
 *      `/auth/login?callbackUrl=<original-url>` so the user returns
 *      where they wanted after signing in. The `callbackUrl` is
 *      always a same-origin pathname (we strip host / protocol) and
 *      the login page re-validates it through `safeCallbackUrl`, so
 *      there's no open-redirect surface here.
 *
 *   4. **Root `/`** is special: for signed-in users we redirect to
 *      `/dashboard` so the root URL is a working entry point; for
 *      guests we redirect to `/auth/login` so the first impression
 *      is the login screen. The root page component itself still
 *      redirects to `/dashboard` as a belt-and-braces fallback in
 *      case middleware is ever bypassed (e.g. preview deployments
 *      with custom rewrites).
 *
 * Demo mode is intentionally kept alive but gated behind auth. Owners
 * and signed-in users can still switch the dataset selector to "Demo
 * data", and a future "Try demo" CTA can point at a public route if
 * we ever want a true marketing demo — this middleware doesn't block
 * that because the future route would simply be added to the public
 * allow-list.
 *
 * Owner / admin bypass is a PLAN-level bypass, not an AUTH-level one.
 * Owners still need a valid NextAuth session; once signed in, the
 * entitlement layer (`src/lib/entitlements.ts`) handles the plan
 * bypass. This middleware never special-cases owner emails — a leaked
 * `OWNER_EMAILS` entry can't let an unauthenticated attacker access
 * the app.
 *
 * Why middleware and not per-page server redirects? Two reasons:
 *   (a) Page components under `(dashboard)/*` are largely client
 *       components; adding `getServerSession` to each would require
 *       wrapping every page in a server shell. Middleware catches
 *       them all in one place, before the page even starts to
 *       render, which also avoids a flash-of-content on slow
 *       networks.
 *   (b) API routes need the same gate. A single middleware matcher
 *       covers both surfaces with identical logic.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Exact paths that are reachable without a session.
 *
 * Kept explicit (and exported-shaped as a `Set`) rather than a regex
 * so it's easy to audit: every string here is an intentional hole in
 * the gate. A typo would at worst accidentally restrict more than
 * intended — it can never accidentally open the gate wider, because
 * the match below requires `exact-or-prefix` hits only for values in
 * the `PUBLIC_PREFIXES` list.
 */
const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/device-limit",
  "/pricing",
  "/billing/success",
  "/billing/cancel",
  // `/api/user/entitlements` returns a caller-scoped envelope (private
  // data for signed-in users, neutral `signedIn: false` for guests) so
  // the public /pricing page can decide whether to show "Sign in" or
  // "Upgrade" CTAs. Exposing this to guests is the whole point — they
  // need the `signedIn:false` answer. It does NOT leak any other user's
  // data, so it's safe public surface.
  "/api/user/entitlements",
  // Next.js / asset health probes
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

/**
 * Public path prefixes. A request is public if its pathname `startsWith`
 * any of these. Keep each entry narrow — we want `/api/auth/foo` to be
 * public but `/api/auth-like-but-not-really` to NOT match, which
 * `startsWith("/api/auth/")` (note the trailing slash) gives us.
 */
const PUBLIC_PREFIXES: readonly string[] = [
  "/auth/",
  "/api/auth/", // NextAuth: csrf, signin, callback, session, providers, ...
  "/api/billing/webhook", // Stripe webhook — own signature-based auth
  "/billing/", // success/cancel + any future post-checkout info pages
  "/samples/", // Sample CSV download for the import page
  "/_next/", // Framework assets
  "/static/", // Legacy static alias (if any)
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Build the login redirect URL, preserving the original path (and
 * search string) as `callbackUrl` so the user lands back on their
 * intended destination after signing in. We deliberately do NOT
 * include the origin — `callbackUrl` is always a pathname, and the
 * login page's `safeCallbackUrl` helper re-validates it to prevent
 * open-redirect attempts via a crafted `callbackUrl=https://evil`.
 */
function loginRedirect(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  // Capture the original path + query; drop host/protocol.
  const original =
    req.nextUrl.pathname + (req.nextUrl.search ? req.nextUrl.search : "");
  url.pathname = "/auth/login";
  url.search = `?callbackUrl=${encodeURIComponent(original)}`;
  // Surface the redirect reason in Response headers for ops debugging.
  const res = NextResponse.redirect(url);
  res.headers.set("x-sn-auth-gate", "redirect-to-login");
  return res;
}

/**
 * 401 envelope for protected API routes. Pages get a 302 redirect (so
 * the browser shows the login form); API callers get a machine-friendly
 * JSON body with the same `callbackUrl` hint they'd have needed anyway.
 * This mirrors what `/api/*` route handlers already do when a handler
 * runs without a session — we intercept one layer earlier so a guest
 * request never even reaches the handler.
 */
function apiUnauthorized(req: NextRequest): NextResponse {
  const original =
    req.nextUrl.pathname + (req.nextUrl.search ? req.nextUrl.search : "");
  return NextResponse.json(
    {
      error: "unauthenticated",
      message: "Sign in to access this API.",
      callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(original)}`,
    },
    {
      status: 401,
      headers: { "x-sn-auth-gate": "api-unauthorized" },
    },
  );
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Every non-matched request is public as far as this module is
  // concerned (see `config.matcher` below). The matcher already
  // excludes `_next/*` and common static files, so in practice we
  // only see app routes + API routes here — but we still run the
  // isPublicPath check first for the ones that ARE inside the
  // dashboard surface but need to stay unauthenticated (e.g.
  // `/pricing`, `/api/billing/webhook`).
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Read the NextAuth JWT at the edge. `getToken` uses NEXTAUTH_SECRET
  // from env and returns `null` when the request has no (valid)
  // session cookie. We don't care about the token payload here — the
  // boolean "is there a token" is all we need.
  //
  // `secureCookie` is inferred from the request host by default, which
  // is right for Vercel (HTTPS in prod, HTTP in local). Leaving the
  // default avoids a mismatch when the app runs behind `localhost` in
  // dev vs. `<app>.vercel.app` in prod.
  const token = await getToken({ req });
  const isAuthenticated = Boolean(token);

  // Root path gets special handling: authenticated → /dashboard,
  // unauthenticated → /auth/login. This replaces the unconditional
  // `/ -> /search` redirect that used to live in `src/app/page.tsx`
  // and was the reason Incognito visitors ended up inside the app.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = isAuthenticated ? "/dashboard" : "/auth/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isAuthenticated) {
    return NextResponse.next();
  }

  // Unauthenticated + protected.
  if (pathname.startsWith("/api/")) {
    return apiUnauthorized(req);
  }
  return loginRedirect(req);
}

export const config = {
  /**
   * Run on every path EXCEPT Next.js internals, the NextAuth callback
   * endpoints, and static files. The middleware itself allow-lists
   * additional public paths (`/pricing`, `/billing/success`, …) so
   * that logic can live alongside its documentation and be unit-
   * testable without reaching into the matcher.
   *
   * The matcher excludes:
   *   - `_next/static` / `_next/image` — build artifacts and the
   *     image optimizer. Without this, middleware would fire on
   *     every chunk + image request.
   *   - `favicon.ico` and common static file extensions — avoid
   *     wasting edge invocations on asset requests.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|woff|woff2|ttf)$).*)",
  ],
};
