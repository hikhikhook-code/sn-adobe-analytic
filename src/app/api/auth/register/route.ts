import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

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
      { error: "Email already registered" },
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
  return NextResponse.json({ user }, { status: 201 });
}
