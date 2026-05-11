import { PrismaClient } from "@prisma/client";

// Importing `env` eagerly triggers the DATABASE_URL check in src/lib/env.ts:
//   - missing in dev/build: warns once and falls back to a local Postgres
//     placeholder URL (see LOCAL_POSTGRES_FALLBACK in env.ts)
//   - missing in strict production runtime: throws with a helpful pointer
//     to docs/DEPLOYMENT.md
// Prisma itself still reads DATABASE_URL from `process.env` via the schema,
// so we only import for its side effects here — not to override the URL.
import { env } from "@/lib/env";

// Keep a reference so bundlers don't tree-shake the side-effectful import.
void env.databaseUrl;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
