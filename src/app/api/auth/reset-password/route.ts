import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { consumeResetToken } from "@/lib/auth-tokens";

/**
 * POST /api/auth/reset-password
 *
 * Validates the opaque reset token, writes the new password hash, and
 * marks the token consumed + every sibling pending token for the user
 * invalidated.
 *
 * Response contract:
 *   - 200 `{ ok: true }` on success.
 *   - 400 `{ error: "Invalid or expired reset link." }` for every token /
 *     userId mismatch. We do NOT distinguish "bad userId" vs "expired
 *     token" vs "already used" in the response — the client can re-kick
 *     the flow from /auth/forgot-password.
 *   - 400 `{ error: "..." }` for weak-password / malformed-input cases.
 *
 * Lock-in: we never log the raw token. The token is only ever compared
 * via `bcrypt.compare` inside `consumeResetToken`, and the plaintext
 * body is discarded as soon as we hash the new password.
 */

const ResetSchema = z.object({
  // cuid — keep permissive enough that a future migration to ulid/uuid
  // doesn't require a schema bump here.
  userId: z.string().min(1).max(128),
  token: z.string().min(1).max(1024),
  password: z.string().min(8).max(120),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message =
      firstIssue?.path.includes("password")
        ? "Password must be at least 8 characters long."
        : "Invalid or expired reset link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { userId, token, password } = parsed.data;

  // Look up the target user first so we don't do a bcrypt scan for a
  // non-existent userId (that would leak timing signal).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 },
    );
  }

  const consumed = await consumeResetToken(user.id, token);
  if (!consumed.ok) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 },
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword },
  });

  return NextResponse.json({ ok: true });
}
