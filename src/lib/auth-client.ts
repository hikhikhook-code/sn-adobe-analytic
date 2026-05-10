/**
 * Client-safe auth flags.
 *
 * NEVER import `@/lib/auth` from client components — it pulls in `bcryptjs`,
 * `prisma`, `next-auth`, `GoogleProvider`, and the server-only env helpers,
 * which balloons the client bundle and leaks secrets paths into the browser.
 *
 * This module exposes ONLY the boolean "is Google OAuth available for this
 * deployment?" flag. It reads `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` so the value
 * is baked into the client at build time without requiring the real
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to ever reach the browser.
 *
 * Build-time toggling:
 *   - If `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` is "1"/"true", the button is
 *     rendered enabled and links to `signIn("google")`.
 *   - Otherwise, the button is rendered but disabled, with a clear
 *     "Sign in with Google is not configured for this deployment" tooltip.
 *
 * CI / production deploys should set:
 *   NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED="1"
 * alongside `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Local dev can
 * leave it unset and the button gracefully disables.
 */
export const GOOGLE_OAUTH_ENABLED_CLIENT: boolean =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
