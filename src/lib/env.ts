/**
 * Centralized environment loading + validation.
 *
 * Design goals:
 *   - Fail loud and early in production if critical secrets are missing or
 *     still set to a placeholder value (e.g. the `replace-with-...` default
 *     shipped in `.env.example`).
 *   - Stay quiet and friendly in local development — a fresh clone that
 *     forgot to `cp .env.example .env` should still boot with sensible
 *     fallbacks (SQLite, dev-only NextAuth secret).
 *   - Do NOT throw at build time even in production. `next build` runs with
 *     `NODE_ENV=production` but `NEXT_PHASE=phase-production-build`, and
 *     the CI workflow deliberately passes a placeholder NEXTAUTH_SECRET
 *     labeled "not-used-at-runtime". Throwing in that window would break
 *     CI and Vercel builds; we only go strict at true request-serving time.
 *   - Never expose secrets on the client. This module exports non-secret
 *     scalars only; anything secret is read lazily by the consumer.
 */

type NodeEnvName = "development" | "production" | "test";

const NODE_ENV: NodeEnvName =
  (process.env.NODE_ENV as NodeEnvName) ?? "development";

// Next.js sets this during `next build`. Any production-only validation
// must be skipped here — the build doesn't actually serve requests, and
// CI intentionally uses placeholder secrets.
const IS_BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";

export const IS_PROD = NODE_ENV === "production";
export const IS_DEV = NODE_ENV === "development";
export const IS_TEST = NODE_ENV === "test";

/**
 * True only in real production *runtime* (not during `next build`).
 * Consumers that need to enforce strict checks (e.g. NextAuth rejecting
 * a placeholder secret) should guard on this.
 */
export const IS_STRICT_RUNTIME = IS_PROD && !IS_BUILD_PHASE;

/**
 * Obvious placeholder values that must never make it to production. The
 * first entry is the literal string shipped in `.env.example`.
 */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "",
  "replace-with-openssl-rand-base64-32",
  "changeme",
  "change-me",
  "secret",
  "your-secret-here",
  "please-change-me",
]);

function warn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[env] ${message}`);
}

function fail(message: string): never {
  throw new Error(`[env] ${message}`);
}

// ---------------------------------------------------------------------------
// DATABASE_URL
// ---------------------------------------------------------------------------
// Required at true production runtime. In dev / build we fall back to the
// local SQLite path so a fresh clone can boot even before `.env` is copied.
function readDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (raw) return raw;

  if (IS_STRICT_RUNTIME) {
    fail(
      "DATABASE_URL is not set. In production, set it in your Vercel project's " +
        "Environment Variables to your Supabase pooled connection string. See " +
        "docs/DEPLOYMENT.md for the exact format.",
    );
  }

  // Build phase or dev: warn (once) and use the local SQLite fallback so
  // `npx prisma generate` and `next build` still work.
  warn(
    "DATABASE_URL is not set. Falling back to 'file:./dev.db' for local " +
      "development. Run `cp .env.example .env` and `npx prisma db push` to " +
      "initialize the local database.",
  );
  return "file:./dev.db";
}

// ---------------------------------------------------------------------------
// NEXTAUTH_SECRET
// ---------------------------------------------------------------------------
// Never exported. Consumers (lib/auth.ts) call `assertNextAuthSecret()` to
// surface the right error at the right time.
function readNextAuthSecret(): string | undefined {
  return process.env.NEXTAUTH_SECRET?.trim() || undefined;
}

/**
 * Run at NextAuth initialization. Returns the secret string, or throws in
 * strict production runtime if the secret is missing / placeholder / too short.
 * In dev and during build, we only warn — dev is allowed a fallback; the build
 * is allowed CI placeholders.
 */
export function assertNextAuthSecret(): string {
  const secret = readNextAuthSecret();

  if (IS_STRICT_RUNTIME) {
    if (!secret) {
      fail(
        "NEXTAUTH_SECRET is required in production. Generate one with " +
          "`openssl rand -base64 32` and set it in your Vercel env vars.",
      );
    }
    if (PLACEHOLDER_SECRETS.has(secret)) {
      fail(
        "NEXTAUTH_SECRET is still set to a placeholder value. Generate a real " +
          "secret with `openssl rand -base64 32` and set it in your Vercel env vars.",
      );
    }
    // Labeled CI/build placeholders are rejected at runtime too.
    if (secret.endsWith("-not-used-at-runtime")) {
      fail(
        "NEXTAUTH_SECRET appears to be a build-only placeholder. Set a real " +
          "secret (openssl rand -base64 32) in your production environment.",
      );
    }
    if (secret.length < 16) {
      fail(
        "NEXTAUTH_SECRET looks too short (< 16 chars). Use " +
          "`openssl rand -base64 32` to generate a strong secret.",
      );
    }
    return secret;
  }

  // Non-strict: dev or build. Warn but do not throw — NextAuth itself has a
  // dev-mode fallback, and build-time secrets are intentionally placeholders.
  if (!secret) {
    if (!IS_BUILD_PHASE) {
      warn(
        "NEXTAUTH_SECRET is not set. NextAuth will use an insecure dev " +
          "fallback. Set one before deploying.",
      );
    }
    return "dev-fallback-not-for-production";
  }
  if (PLACEHOLDER_SECRETS.has(secret) && !IS_BUILD_PHASE) {
    warn(
      "NEXTAUTH_SECRET is set to a placeholder. OK for local dev, but set a " +
        "real one before deploying.",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// DATA_PROVIDER
// ---------------------------------------------------------------------------
const KNOWN_PROVIDERS = ["mock", "official", "manual", "public"] as const;
export type DataProviderName = (typeof KNOWN_PROVIDERS)[number];

function readDataProvider(): DataProviderName {
  const raw = (process.env.DATA_PROVIDER ?? "mock").toLowerCase().trim();
  if ((KNOWN_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as DataProviderName;
  }
  warn(
    `DATA_PROVIDER="${raw}" is not recognized. Falling back to "mock". ` +
      `Valid values: ${KNOWN_PROVIDERS.join(", ")}.`,
  );
  return "mock";
}

// ---------------------------------------------------------------------------
// ENABLE_PUBLIC_SCRAPER
// ---------------------------------------------------------------------------
// Boolean flag that (a) aliases `DATA_PROVIDER=official` onto the public-
// metadata scraper and (b) documents the intent to read public Adobe
// Stock pages. Explicit `DATA_PROVIDER=public` ignores this flag and
// always uses the scraper.
function readEnablePublicScraper(): boolean {
  const raw = (process.env.ENABLE_PUBLIC_SCRAPER ?? "").toLowerCase().trim();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

// ---------------------------------------------------------------------------
// MAX_IMPORT_FILE_SIZE_MB
// ---------------------------------------------------------------------------
const DEFAULT_IMPORT_MB = 10;
const HARD_CAP_IMPORT_MB = 100;

function readMaxImportMb(): number {
  const raw = process.env.MAX_IMPORT_FILE_SIZE_MB?.trim();
  if (!raw) return DEFAULT_IMPORT_MB;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    warn(
      `MAX_IMPORT_FILE_SIZE_MB="${raw}" is not a positive number. ` +
        `Falling back to ${DEFAULT_IMPORT_MB}MB.`,
    );
    return DEFAULT_IMPORT_MB;
  }
  if (n > HARD_CAP_IMPORT_MB) {
    warn(
      `MAX_IMPORT_FILE_SIZE_MB=${n} exceeds the hard cap of ${HARD_CAP_IMPORT_MB}. ` +
        `Clamping to ${HARD_CAP_IMPORT_MB}MB.`,
    );
    return HARD_CAP_IMPORT_MB;
  }
  return n;
}

// ---------------------------------------------------------------------------
// USE_LIVE_SCRAPER
// ---------------------------------------------------------------------------
// Always forced off in production regardless of what the env says. This is a
// hard safety rail: we do not ship a live Adobe Stock scraper and refuse to
// let one be flipped on via a misconfigured prod env.
function readUseLiveScraper(): boolean {
  const raw = (process.env.USE_LIVE_SCRAPER ?? "").toLowerCase();
  if (IS_PROD) return false;
  return raw === "true" || raw === "1" || raw === "yes";
}

// ---------------------------------------------------------------------------
// Public env object
// ---------------------------------------------------------------------------
const maxImportMb = readMaxImportMb();

export const env = {
  nodeEnv: NODE_ENV,
  isProd: IS_PROD,
  isDev: IS_DEV,
  isTest: IS_TEST,
  isStrictRuntime: IS_STRICT_RUNTIME,
  isBuildPhase: IS_BUILD_PHASE,
  databaseUrl: readDatabaseUrl(),
  dataProvider: readDataProvider(),
  enablePublicScraper: readEnablePublicScraper(),
  maxImportFileSizeMb: maxImportMb,
  maxImportFileSizeBytes: maxImportMb * 1024 * 1024,
  useLiveScraper: readUseLiveScraper(),
} as const;

/**
 * Explicit one-shot validation helper. Primarily used by startup code
 * (e.g. a future `src/app/layout.tsx` server-only block, or tests) to
 * surface every env problem up-front instead of waiting for the first
 * request that happens to need a given secret.
 *
 * Returns the list of non-fatal warnings (empty on a clean env); throws
 * on any fatal problem in strict runtime.
 */
export function validateEnv(): string[] {
  const warnings: string[] = [];

  if (!process.env.DATABASE_URL) {
    warnings.push(
      "DATABASE_URL is not set; falling back to 'file:./dev.db' (dev only).",
    );
  }
  if (!process.env.NEXTAUTH_SECRET) {
    warnings.push(
      "NEXTAUTH_SECRET is not set; NextAuth will use an insecure dev fallback.",
    );
  }
  if (!process.env.NEXTAUTH_URL) {
    warnings.push(
      "NEXTAUTH_URL is not set; OAuth callbacks will use the request host.",
    );
  }

  // Invoke the strict path — will throw in production runtime.
  assertNextAuthSecret();

  return warnings;
}
