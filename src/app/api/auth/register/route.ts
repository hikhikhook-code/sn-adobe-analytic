import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bootstrapOwnerIfEligible } from "@/lib/owner-bootstrap";

const RegisterSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(120),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    // Structured error so the UI can show a friendlier message with a
    // "Sign in" link instead of just surfacing the raw string.
    return NextResponse.json(
      {
        error: "That email is already registered. Try signing in instead.",
        code: "email_taken",
      },
      { status: 409 },
    );
  }
  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      hashedPassword,
    },
    select: { id: true, email: true, name: true },
  });

  // PR #18: eager owner-access bootstrap on register. Covers the case
  // where the operator whitelisted their email in OWNER_EMAILS and
  // then registered fresh — they become OWNER at account creation,
  // not only after a subsequent sign-in event. Non-blocking: bootstrap
  // failures must never 500 the register response.
  try {
    await bootstrapOwnerIfEligible(user.id, user.email);
  } catch {
    // Intentionally swallowed. The lazy bootstrap in
    // getSessionEntitlements will retry on the user's next request.
  }

  return NextResponse.json({ user }, { status: 201 });
}
