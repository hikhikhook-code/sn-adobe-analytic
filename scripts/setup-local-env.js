#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * setup-local-env.js — zero-friction `.env` bootstrap for local development.
 *
 * The only reason this script exists: editing `.env` by hand on a phone
 * (Termux) or a fresh clone is annoying. After running `npm run setup:local`
 * the user can immediately do `npx prisma db push && npm run dev`.
 *
 * What it does:
 *   1. If `.env` does not exist, copy `.env.example` into `.env` (creating
 *      the file and preserving .gitignore rules).
 *   2. Ensure every key listed in LOCAL_SAFE_DEFAULTS is present with a
 *      sane local-dev value. Existing user values are never overwritten —
 *      except for NEXTAUTH_SECRET when it still holds the placeholder we
 *      ship in .env.example.
 *   3. Write the file back with the same formatting as `.env.example`
 *      (preserves comments, key order, trailing newline).
 *
 * Explicitly NOT in scope:
 *   - Production config. The values written here are labelled with the
 *     string "local-dev-" so `src/lib/env.ts` keeps rejecting them in
 *     strict-production runtime (see README "Env validation").
 *   - Real secrets. Everything written is a public placeholder suitable
 *     for SQLite-backed local dev.
 *   - Idempotence beyond the list below. If a user has custom keys in
 *     their `.env`, we leave them untouched.
 *
 * Safe to run repeatedly. Only prints what it changes.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");

/**
 * Dev-only defaults. Keys a fresh clone MUST have for the app to boot.
 * Everything else (Stripe / PayPal / Google OAuth / Supabase) is left
 * blank — those are optional for local dev.
 *
 * NEXTAUTH_SECRET: deliberately starts with "local-dev-" so the strict-
 * runtime guard in `src/lib/env.ts` rejects it if it ever leaks to
 * production. It IS long enough (> 16 chars) to satisfy the dev-mode
 * NextAuth requirement.
 */
const LOCAL_SAFE_DEFAULTS = {
  DATABASE_URL: "file:./dev.db",
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "local-dev-secret-123456789123456789",
  DATA_PROVIDER: "mock",
  MAX_IMPORT_FILE_SIZE_MB: "10",
  USE_LIVE_SCRAPER: "false",
  // PR #22 public-metadata scraper is OFF by default. Flip to
  // "true" in your local .env (or set PUBLIC_SCRAPER_ALLOW_PROD
  // alongside it in prod) when you explicitly want to read public
  // Adobe Stock pages.
  PUBLIC_SCRAPER_ENABLED: "false",
  PUBLIC_SCRAPER_ALLOW_PROD: "false",
};

/**
 * Values we consider "placeholder" NEXTAUTH_SECRETs safe to upgrade to
 * the local-dev secret. Anything NOT in this set is treated as a real
 * user secret and left alone — the user may have already generated one
 * with `openssl rand -base64 32`.
 */
const REPLACEABLE_NEXTAUTH_PLACEHOLDERS = new Set([
  "",
  "replace-with-openssl-rand-base64-32",
  "changeme",
  "change-me",
  "secret",
  "your-secret-here",
  "please-change-me",
]);

/**
 * Parse a dotenv-style string into { key: value } + the original line list.
 * We keep line fidelity (comments, blank lines, original quoting style)
 * so we can rewrite the file without reformatting it.
 */
function parseEnvFile(contents) {
  const lines = contents.split(/\r?\n/);
  const entries = new Map();
  lines.forEach((line, index) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) return;
    const key = match[1];
    let raw = match[2].trim();
    // Strip surrounding double-quotes or single-quotes, if present,
    // because we compare the VALUE to the placeholder set. We keep the
    // original line so rewriting preserves the user's quoting choice.
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    entries.set(key, { value: raw, lineIndex: index });
  });
  return { lines, entries };
}

/**
 * Serialize a value the same way .env.example does: always double-quoted,
 * with inner double-quotes escaped. Keeps diffs tidy.
 */
function formatEnvLine(key, value) {
  const escaped = String(value).replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

function loadOrCreateEnv() {
  if (fs.existsSync(ENV_PATH)) {
    return {
      text: fs.readFileSync(ENV_PATH, "utf8"),
      createdFromExample: false,
    };
  }
  if (!fs.existsSync(EXAMPLE_PATH)) {
    // Very unlikely: a clone without .env.example. Fall back to writing
    // just the safe defaults.
    const minimal =
      Object.entries(LOCAL_SAFE_DEFAULTS)
        .map(([k, v]) => formatEnvLine(k, v))
        .join("\n") + "\n";
    fs.writeFileSync(ENV_PATH, minimal, "utf8");
    return { text: minimal, createdFromExample: false };
  }
  const example = fs.readFileSync(EXAMPLE_PATH, "utf8");
  fs.writeFileSync(ENV_PATH, example, "utf8");
  return { text: example, createdFromExample: true };
}

function main() {
  const { text, createdFromExample } = loadOrCreateEnv();
  const { lines, entries } = parseEnvFile(text);
  const changes = [];
  let nextLines = lines.slice();

  for (const [key, devValue] of Object.entries(LOCAL_SAFE_DEFAULTS)) {
    const existing = entries.get(key);
    if (!existing) {
      // Key missing — append at end. Record the change.
      nextLines.push(formatEnvLine(key, devValue));
      changes.push(`+ ${key} (added)`);
      continue;
    }

    // NEXTAUTH_SECRET has the special "replace placeholder" rule.
    if (key === "NEXTAUTH_SECRET") {
      if (REPLACEABLE_NEXTAUTH_PLACEHOLDERS.has(existing.value)) {
        nextLines[existing.lineIndex] = formatEnvLine(key, devValue);
        changes.push(`~ ${key} (placeholder -> local-dev secret)`);
      }
      // else: real user secret, leave alone.
      continue;
    }

    // For other keys, if the value is empty, fill it with the default.
    // This is the common "the user cleared NEXTAUTH_URL somehow" recovery
    // path without overwriting anything deliberate.
    if (existing.value === "") {
      nextLines[existing.lineIndex] = formatEnvLine(key, devValue);
      changes.push(`~ ${key} (empty -> default)`);
    }
    // Non-empty user value — leave alone.
  }

  // Preserve trailing newline convention. `.env.example` ends with one;
  // make sure we do too.
  let serialized = nextLines.join("\n");
  if (!serialized.endsWith("\n")) serialized += "\n";

  fs.writeFileSync(ENV_PATH, serialized, "utf8");

  // Human-readable summary. Intentionally terse — this script runs every
  // time you invoke `npm run dev:local`, so silent-no-op is the norm.
  if (createdFromExample) {
    console.log("setup-local-env: created .env from .env.example");
  }
  if (changes.length === 0) {
    if (!createdFromExample) {
      console.log("setup-local-env: .env already has safe local defaults — nothing to do.");
    } else {
      console.log("setup-local-env: .env now has safe local defaults. You can run `npx prisma db push` and `npm run dev`.");
    }
  } else {
    console.log("setup-local-env: applied local-dev defaults:");
    for (const c of changes) console.log(`  ${c}`);
    console.log("setup-local-env: done. Run `npx prisma db push` next, then `npm run dev`.");
  }
}

try {
  main();
} catch (err) {
  console.error("setup-local-env failed:", err && err.message ? err.message : err);
  process.exit(1);
}
