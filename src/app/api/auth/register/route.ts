import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bootstrapOwnerIfEligible } from "@/lib/owner-bootstrap";
import { sendVerificationEmail } from "@/lib/email-verification";

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

  // Send verification email
  try {
    await sendVerificationEmail(user.email, user.name);
  } catch (error) {
    console.error("Failed to send verification email:", error);
    // Non-blocking: email send failure should not prevent registration
    // but we should log it for debugging
  }

  // PR #18: eager owner-access bootstrap on register
  try {
    await bootstrapOwnerIfEligible(user.id, user.email);
  } catch {
    // Intentionally swallowed. The lazy bootstrap in
    // getSessionEntitlements will retry on the user''s next request.
  }

  return NextResponse.json(
    {
      user,
      message: "Account created. Please check your email to verify your address.",
    },
    { status: 201 },
  );
}
