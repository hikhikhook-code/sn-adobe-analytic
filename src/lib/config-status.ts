/**
 * Production config sanity check (PR: production-readiness).
 *
 * Reports which env-var groups are configured, without ever echoing
 * secret values. Designed to answer one specific question fast:
 * *"Is this deployment configured the way the operator expected?"*
 *
 * Two consumers:
 *   - `logConfigStatus()` — server-only. Emits one compact JSON line
 *     at startup so the operator can see from Vercel logs exactly
 *     which features are wired. No secret values; booleans + lengths
 *     + obvious categorical fields (e.g. `dataProvider: "mock"`) only.
 *   - `getConfigStatus()` — server-only. Returns a structured object
 *     for the owner-only `/api/admin/config-status` endpoint, so the
 *     operator can check the same facts from the UI after deploy.
 *
 * What this module **never** does:
 *   - Echo secret values (`NEXTAUTH_SECRET`, `STRIPE_SECRET_KEY`,
 *     `GOOGLE_CLIENT_SECRET`, Supabase keys, etc). Only booleans and
 *     non-sensitive scalars (e.g. the provider name, whether a URL
 *     is set — not the URL itself when it contains a password).
 *   - Throw. Its job is to *report* config state, not enforce it.
 *     Strict-runtime enforcement already lives in `src/lib/env.ts`.
 *   - Run during `next build`. The build phase sets
 *     `NEXT_PHASE=phase-production-build`, and we skip the log so
 *     build output stays clean.
 */

import { IS_STRICT_RUNTIME, env } from "@/lib/env";

/** Convenience aliases mirroring the module-local flags in `env.ts`. */
const IS_BUILD_PHASE = env.isBuildPhase;

/** "ok" | "missing" | "placeholder" | "too_short" | "skipped". */
export type ConfigFieldState =
  | "ok"
  | "missing"
  | "placeholder"
  | "too_short"
  | "skipped";

export interface ConfigGroupStatus {
  /** True when every required var in the group has a real value. */
  ok: boolean;
  /** Per-field rollup. Secrets are only reported as state, never value. */
  fields: Record<string, ConfigFieldState>;
  /** Optional human-readable note for the operator. */
  note?: string;
}

export interface ConfigStatus {
  nodeEnv: "development" | "production" | "test";
  isBuildPhase: boolean;
  isStrictRuntime: boolean;
  /** Required group (app refuses to boot in production without these). */
  required: ConfigGroupStatus;
  /** Optional provider / import / scraper config. */
  providers: ConfigGroupStatus & { dataProvider: string };
  /** Optional Google OAuth wiring. */
  googleOAuth: ConfigGroupStatus & { clientFlagEnabled: boolean };
  /** Optional owner bootstrap. */
  ownerBootstrap: { configuredEmailCount: number };
  /** Optional / deferred payment integration. */
  payment: ConfigGroupStatus & {
    stripeConfigured: boolean;
    webhookConfigured: boolean;
    priceIdsConfigured: Record<string, boolean>;
    paypalConfigured: boolean;
  };
  /** Optional Supabase JS-client wiring (Prisma does NOT need this). */
  supabaseClient: ConfigGroupStatus;
  /** Summary flags for quick log-line consumption. */
  summary: {
    requiredOk: boolean;
    googleOAuthEnabled: boolean;
    paymentEnabled: boolean;
    publicScraperEnabled: boolean;
    ownerBootstrapEnabled: boolean;
  };
}

/**
 * Placeholder values that look "set" but are actually the scaffold values
 * shipped in `.env.example`. Also matches the CI marker shape.
 */
const SECRET_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "",
  "replace-with-openssl-rand-base64-32",
  "changeme",
  "change-me",
  "secret",
  "your-secret-here",
  "please-change-me",
]);

function classifySecret(
  raw: string | undefined,
  opts?: { minLength?: number },
): ConfigFieldState {
  const v = raw?.trim() ?? "";
  if (!v) return "missing";
  if (SECRET_PLACEHOLDERS.has(v)) return "placeholder";
  if (v.endsWith("-not-used-at-runtime")) return "placeholder";
  const min = opts?.minLength ?? 1;
  if (v.length < min) return "too_short";
  return "ok";
}

function classifyPresent(raw: string | undefined): ConfigFieldState {
  const v = raw?.trim() ?? "";
  return v ? "ok" : "missing";
}

/**
 * Snapshot the current process env into a safe config-status object.
 * Pure function — safe to call multiple times.
 */
export function getConfigStatus(): ConfigStatus {
  // --- Required group ---
  const dbUrl = classifyPresent(process.env.DATABASE_URL);
  const directUrl = classifyPresent(process.env.DIRECT_URL);
  const authUrl = classifyPresent(process.env.NEXTAUTH_URL);
  const authSecret = classifySecret(process.env.NEXTAUTH_SECRET, {
    minLength: 16,
  });
  const required: ConfigGroupStatus = {
    ok:
      dbUrl === "ok" &&
      directUrl === "ok" &&
      authUrl === "ok" &&
      authSecret === "ok",
    fields: {
      DATABASE_URL: dbUrl,
      DIRECT_URL: directUrl,
      NEXTAUTH_URL: authUrl,
      NEXTAUTH_SECRET: authSecret,
    },
    note:
      dbUrl === "ok" &&
      directUrl === "ok" &&
      authUrl === "ok" &&
      authSecret === "ok"
        ? undefined
        : "Production will refuse to boot without these. See docs/DEPLOYMENT.md.",
  };

  // --- Providers / scraper ---
  const officialBase = classifyPresent(process.env.OFFICIAL_PROVIDER_BASE_URL);
  const officialKey = classifyPresent(process.env.OFFICIAL_PROVIDER_API_KEY);
  const scraperEnabled =
    (process.env.PUBLIC_SCRAPER_ENABLED ?? "").toLowerCase() === "true";
  const scraperAllowProd =
    (process.env.PUBLIC_SCRAPER_ALLOW_PROD ?? "").toLowerCase() === "true";
  const publicScraperEnabled =
    scraperEnabled && (!IS_STRICT_RUNTIME || scraperAllowProd);
  const providers: ConfigGroupStatus & { dataProvider: string } = {
    ok: true,
    dataProvider: env.dataProvider,
    fields: {
      OFFICIAL_PROVIDER_BASE_URL: officialBase,
      OFFICIAL_PROVIDER_API_KEY: officialKey,
      PUBLIC_SCRAPER_ENABLED: scraperEnabled ? "ok" : "missing",
      PUBLIC_SCRAPER_ALLOW_PROD: scraperAllowProd ? "ok" : "missing",
    },
    note:
      env.dataProvider === "official" || env.dataProvider === "public"
        ? officialBase === "ok" || publicScraperEnabled
          ? undefined
          : "DATA_PROVIDER is set to public/official but neither OFFICIAL_PROVIDER_BASE_URL nor the public scraper are configured. The provider will return empty results with a 'not configured' notice."
        : undefined,
  };

  // --- Google OAuth ---
  const googleId = classifyPresent(process.env.GOOGLE_CLIENT_ID);
  const googleSecret = classifySecret(process.env.GOOGLE_CLIENT_SECRET, {
    minLength: 8,
  });
  const googleClientFlag = (
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED ?? ""
  ).trim();
  const googleClientFlagEnabled = googleClientFlag === "1";
  const serverOk = googleId === "ok" && googleSecret === "ok";
  const googleOAuth: ConfigGroupStatus & { clientFlagEnabled: boolean } = {
    ok: serverOk && googleClientFlagEnabled,
    clientFlagEnabled: googleClientFlagEnabled,
    fields: {
      GOOGLE_CLIENT_ID: googleId,
      GOOGLE_CLIENT_SECRET: googleSecret,
      NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: googleClientFlagEnabled
        ? "ok"
        : "missing",
    },
    note:
      serverOk && !googleClientFlagEnabled
        ? "Google server env is set but NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1 is missing. Button will render disabled."
        : !serverOk && googleClientFlagEnabled
          ? "NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1 but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing. Button will still render disabled."
          : undefined,
  };

  // --- Owner bootstrap ---
  const ownerEmailsRaw = (process.env.OWNER_EMAILS ?? "").trim();
  const configuredEmailCount = ownerEmailsRaw
    ? ownerEmailsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0).length
    : 0;

  // --- Payment (deferred) ---
  const stripeSecret = classifySecret(process.env.STRIPE_SECRET_KEY, {
    minLength: 20,
  });
  const stripeWebhook = classifySecret(process.env.STRIPE_WEBHOOK_SECRET, {
    minLength: 20,
  });
  const stripePub = classifyPresent(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );
  const priceIds = {
    STRIPE_STARTER_PRICE_ID_USD: classifyPresent(
      process.env.STRIPE_STARTER_PRICE_ID_USD,
    ),
    STRIPE_PRO_PRICE_ID_USD: classifyPresent(
      process.env.STRIPE_PRO_PRICE_ID_USD,
    ),
    STRIPE_ANNUAL_PRICE_ID_USD: classifyPresent(
      process.env.STRIPE_ANNUAL_PRICE_ID_USD,
    ),
    STRIPE_STARTER_PRICE_ID_IDR: classifyPresent(
      process.env.STRIPE_STARTER_PRICE_ID_IDR,
    ),
    STRIPE_PRO_PRICE_ID_IDR: classifyPresent(
      process.env.STRIPE_PRO_PRICE_ID_IDR,
    ),
    STRIPE_ANNUAL_PRICE_ID_IDR: classifyPresent(
      process.env.STRIPE_ANNUAL_PRICE_ID_IDR,
    ),
  } as const;
  const priceIdsConfigured: Record<string, boolean> = Object.fromEntries(
    Object.entries(priceIds).map(([k, v]) => [k, v === "ok"]),
  );
  const paypalId = classifyPresent(process.env.PAYPAL_CLIENT_ID);
  const paypalSecret = classifySecret(process.env.PAYPAL_CLIENT_SECRET, {
    minLength: 8,
  });
  const stripeConfigured = stripeSecret === "ok";
  const webhookConfigured = stripeWebhook === "ok";
  const paypalConfigured = paypalId === "ok" && paypalSecret === "ok";
  const payment: ConfigStatus["payment"] = {
    ok: stripeConfigured && webhookConfigured,
    stripeConfigured,
    webhookConfigured,
    priceIdsConfigured,
    paypalConfigured,
    fields: {
      STRIPE_SECRET_KEY: stripeSecret,
      STRIPE_WEBHOOK_SECRET: stripeWebhook,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: stripePub,
      ...priceIds,
      PAYPAL_CLIENT_ID: paypalId,
      PAYPAL_CLIENT_SECRET: paypalSecret,
    },
    note: stripeConfigured
      ? webhookConfigured
        ? "Payment env is set. End-to-end verification against a live Stripe account is still required before treating paid plans as production-ready."
        : "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing. Plan upgrades will not activate until the webhook is configured."
      : "Payment is not configured. /pricing will render but checkout returns 503 stripe_not_configured.",
  };

  // --- Supabase JS client (Prisma does NOT need this) ---
  const supaUrl = classifyPresent(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supaAnon = classifyPresent(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supaSrv = classifyPresent(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabaseClient: ConfigGroupStatus = {
    ok: supaUrl === "ok" && supaAnon === "ok",
    fields: {
      NEXT_PUBLIC_SUPABASE_URL: supaUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supaAnon,
      SUPABASE_SERVICE_ROLE_KEY: supaSrv,
    },
    note:
      supaUrl === "ok" || supaAnon === "ok" || supaSrv === "ok"
        ? "Supabase JS client is partially configured. Prisma does not use these — they only matter if the app calls @supabase/supabase-js directly."
        : undefined,
  };

  return {
    nodeEnv: env.nodeEnv,
    isBuildPhase: IS_BUILD_PHASE,
    isStrictRuntime: IS_STRICT_RUNTIME,
    required,
    providers,
    googleOAuth,
    ownerBootstrap: { configuredEmailCount },
    payment,
    supabaseClient,
    summary: {
      requiredOk: required.ok,
      googleOAuthEnabled: googleOAuth.ok,
      paymentEnabled: payment.ok,
      publicScraperEnabled,
      ownerBootstrapEnabled: configuredEmailCount > 0,
    },
  };
}

/**
 * Emit a single compact JSON log line summarizing the deployment's
 * config posture. Safe to call from any server context; no-op during
 * `next build` (to keep build output clean) and in test.
 *
 * The second time we're called in the same Node process we short-circuit
 * — serverless functions can spin up multiple handlers that each import
 * this module, and we don't want one-line-per-handler spam. The guard
 * lives on `globalThis` so hot-reload in dev also collapses the log.
 */
const LOGGED_KEY = "__SN_CONFIG_STATUS_LOGGED__";

export function logConfigStatus(): void {
  if (IS_BUILD_PHASE) return;
  if (process.env.NODE_ENV === "test") return;
  const g = globalThis as unknown as Record<string, boolean>;
  if (g[LOGGED_KEY]) return;
  g[LOGGED_KEY] = true;

  const s = getConfigStatus();
  // eslint-disable-next-line no-console
  console.log(
    "[config-status]",
    JSON.stringify({
      nodeEnv: s.nodeEnv,
      requiredOk: s.summary.requiredOk,
      dataProvider: s.providers.dataProvider,
      googleOAuth: s.summary.googleOAuthEnabled,
      ownerBootstrapEmails: s.ownerBootstrap.configuredEmailCount,
      payment: s.summary.paymentEnabled,
      publicScraper: s.summary.publicScraperEnabled,
    }),
  );

  // In production, surface any anomalies as a second line so log-search
  // on "[config-status] warn" reliably finds misconfigured deploys.
  if (!IS_STRICT_RUNTIME) return;
  const warnings: string[] = [];
  if (!s.required.ok) {
    // We shouldn't reach here — assertNextAuthSecret() would have thrown
    // before this point — but report anyway so the operator can grep.
    warnings.push("required_env_incomplete");
  }
  if (
    (s.providers.dataProvider === "official" ||
      s.providers.dataProvider === "public") &&
    s.providers.fields.OFFICIAL_PROVIDER_BASE_URL !== "ok" &&
    !s.summary.publicScraperEnabled
  ) {
    warnings.push("public_provider_selected_but_unconfigured");
  }
  if (s.googleOAuth.clientFlagEnabled && !s.googleOAuth.ok) {
    warnings.push("google_oauth_partial");
  }
  if (s.payment.stripeConfigured && !s.payment.webhookConfigured) {
    warnings.push("stripe_missing_webhook_secret");
  }
  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config-status] warn",
      JSON.stringify({ warnings }),
    );
  }
}
