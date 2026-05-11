import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bootstrapOwnerIfEligible } from "@/lib/owner-bootstrap";

const RegisterSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(120),
});

/**
 * Bug-fix PR: users reported hitting the generic
 * "Could not create your account. Please try again in a moment." message
 * during registration, with no way to tell what actually failed on the
 * server.
 *
 * The previous handler let any Prisma error bubble up as an unhandled
 * exception. Next.js turned that into an opaque 500 with no body, which
 * the client mapped to the generic fallback string — hiding the real
 * cause (Supabase tables not migrated yet, pgBouncer missing
 * `?pgbouncer=true`, DB unreachable from Vercel, column drift from an
 * older schema, etc).
 *
 * We now:
 *   - classify Prisma errors into stable `code` strings that the UI
 *     maps to actionable copy;
 *   - log the underlying error server-side with a `[register]` prefix so
 *     Vercel log search surfaces it quickly;
 *   - never leak stack traces, table names, or connection strings to
 *     the client.
 *
 * The code list is intentionally short: the UI only needs enough
 * distinctions to render different help text, not a full taxonomy of
 * Prisma errors.
 */

type RegisterErrorCode =
  | "email_taken"
  | "invalid_input"
  | "db_not_migrated"
  | "db_unreachable"
  | "server_error";

interface RegisterErrorBody {
  error: string;
  code: RegisterErrorCode;
  /** Short server-side hint, never echoing secret values. */
  hint?: string;
}

/** Classify an unknown thrown value into a stable response shape. */
function classifyError(err: unknown): {
  status: number;
  body: RegisterErrorBody;
} {
  // The app refuses to start in strict production if DATABASE_URL or
  // NEXTAUTH_SECRET are missing, so by the time a request reaches us
  // the connection URL is at least present. The errors we can still see:
  //   - P1001 Can't reach database server
  //   - P1002 DB server closed connection
  //   - P1003 DB does not exist
  //   - P2021 Table does not exist
  //   - P2022 Column does not exist
  //   - P2024 Timed out fetching a new connection from the pool
  //   - 42P05 "prepared statement already exists" (missing pgbouncer=true)

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // Unique-constraint race: another request just inserted the same
      // email between our findUnique and create. Return the same 409
      // shape the explicit duplicate check produces so the UI handles
      // both branches identically.
      return {
        status: 409,
        body: {
          error: "That email is already registered. Try signing in instead.",
          code: "email_taken",
        },
      };
    }
    if (err.code === "P2021" || err.code === "P2022") {
      return {
        status: 503,
        body: {
          error:
            "Account storage isn't ready yet on this deployment. The database schema hasn't been applied.",
          code: "db_not_migrated",
          hint: "Run `npx prisma db push` (or `prisma migrate deploy`) against the Supabase DIRECT_URL. See docs/DEPLOYMENT.md §8.",
        },
      };
    }
    if (err.code === "P2024") {
      return {
        status: 503,
        body: {
          error:
            "Account service is busy right now. Please try again in a moment.",
          code: "db_unreachable",
          hint: "Prisma connection-pool timeout. If this persists, check Supabase pooler status and DATABASE_URL ?connection_limit=.",
        },
      };
    }
    // Catch-all known Prisma error: return server_error with the code so
    // operator logs still carry the specific Prisma code.
    return {
      status: 500,
      body: {
        error: "Could not create your account right now.",
        code: "server_error",
        hint: `prisma_${err.code}`,
      },
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    // DB unreachable, wrong credentials, DB name missing, etc.
    return {
      status: 503,
      body: {
        error:
          "Account service is temporarily unavailable. The database isn't reachable from this deployment.",
        code: "db_unreachable",
        hint: "Check DATABASE_URL in Vercel → Settings → Environment Variables. Supabase pooled URL must use port 6543 with ?pgbouncer=true&connection_limit=1.",
      },
    };
  }

  // Postgres "prepared statement already exists" (42P05) surfaces as a
  // PrismaClientUnknownRequestError when pgBouncer is in transaction
  // mode without ?pgbouncer=true.
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = err.message?.toLowerCase() ?? "";
    if (
      msg.includes("prepared statement") ||
      msg.includes("42p05") ||
      msg.includes("26000")
    ) {
      return {
        status: 503,
        body: {
          error:
            "Account service is temporarily misconfigured. The database connection pool can't run prepared statements.",
          code: "db_unreachable",
          hint: "pgBouncer transaction pooler requires DATABASE_URL to include ?pgbouncer=true&connection_limit=1. See docs/DEPLOYMENT.md §4.",
        },
      };
    }
    return {
      status: 500,
      body: {
        error: "Could not create your account right now.",
        code: "server_error",
        hint: "prisma_unknown_request",
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "Could not create your account right now.",
      code: "server_error",
    },
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "invalid_input" satisfies RegisterErrorCode },
      { status: 400 },
    );
  }
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid input",
        code: "invalid_input" satisfies RegisterErrorCode,
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "That email is already registered. Try signing in instead.",
          code: "email_taken" satisfies RegisterErrorCode,
        },
        { status: 409 },
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        hashedPassword,
      },
      select: { id: true, email: true, name: true },
    });

    // PR #18: eager owner-access bootstrap on register. Non-blocking so a
    // bootstrap failure never 500s the register response — the lazy
    // bootstrap inside getSessionEntitlements retries on next request.
    try {
      await bootstrapOwnerIfEligible(user.id, user.email);
    } catch (bootstrapErr) {
      // Keep register flow succeeding; log so the operator can still grep
      // for bootstrap regressions separately.
      console.warn(
        "[register] owner bootstrap failed (non-fatal):",
        bootstrapErr instanceof Error ? bootstrapErr.message : bootstrapErr,
      );
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = classifyError(err);

    // Full server-side log (never shown to the client). Includes the
    // Prisma error code when available so `[register]` + the code is
    // enough to triage from Vercel logs.
    const prismaCode =
      err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
    console.error(
      "[register] create failed",
      JSON.stringify({
        responseCode: errBody.code,
        status,
        prismaCode,
        message: err instanceof Error ? err.message : String(err),
      }),
    );

    return NextResponse.json(errBody, { status });
  }
}
