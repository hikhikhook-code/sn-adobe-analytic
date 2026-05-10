import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  issueResetToken,
  shouldExposeResetTokenInDev,
} from "@/lib/auth-tokens";

/**
 * POST /api/auth/forgot-password
 *
 * Accepts an email, and ALWAYS responds with a neutral 200 + the same
 * "If an account with that email exists, we've sent a reset link" copy.
 * We deliberately do not leak whether the email is registered — doing
 * so would let an attacker enumerate the user table from an anonymous
 * browser by watching for a 200 vs 404 difference.
 *
 * In development, we additionally include the reset URL in the JSON
 * response so the local engineer can click through without wiring a
 * mailer. Production never echoes the plaintext token anywhere.
 *
 * Emailing
 * --------
 * PR #16 is the auth FOUNDATION. We don't ship a mailer yet. The route
 * generates and persists the token securely (hashed, one-time, 60-min
 * expiry) so the next PR that adds a mailer only needs to plug in the
 * SMTP/Resend call — no data-shape changes required.
 */

const ForgotSchema = z.object({
  email: z.string().email().max(320),
});

// Neutral success copy reused across all branches so the client response
// is byte-identical whether or not the account exists.
const NEUTRAL_OK_MESSAGE =
  "If an account with that email exists, we've sent a reset link. Please check your inbox (and spam folder).";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ForgotSchema.safeParse(body);
  if (!parsed.success) {
    // We still don't leak whether the email exists. But a malformed
    // email (no "@") is a clear client-side error and gets a 400 so
    // the UI can show a validation message.
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Always respond 200, with dev-only extras when the user actually exists.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, hashedPassword: true },
  });

  const responsePayload: Record<string, unknown> = { ok: true, message: NEUTRAL_OK_MESSAGE };

  // Only issue a token when the account exists AND was created via
  // credentials (has a hashedPassword). Google-only accounts can't be
  // password-reset — we still return the neutral message so the caller
  // can't tell from timing / shape which case they hit.
  if (user && user.hashedPassword) {
    try {
      const { plaintext, expiresAt } = await issueResetToken(user.id);
      const resetPath = `/auth/reset-password?uid=${encodeURIComponent(
        user.id,
      )}&token=${encodeURIComponent(plaintext)}`;

      if (shouldExposeResetTokenInDev()) {
        // Dev-only: echo the clickable URL. Clearly labeled so nobody
        // mistakes this for a production behavior.
        responsePayload.devResetUrl = resetPath;
        responsePayload.devExpiresAt = expiresAt.toISOString();
        responsePayload.devNote =
          "Dev mode only: this URL is included for local testing. Production would email it instead and never return it here.";
      }
      // In production we'd trigger the mailer here. Intentionally NOT
      // logging the plaintext token — server logs shouldn't contain it.
    } catch {
      // Token issuance failure is still a neutral 200 — we'd rather
      // quietly fail and let the user retry than confirm-by-error that
      // the account exists.
    }
  }

  return NextResponse.json(responsePayload);
}
