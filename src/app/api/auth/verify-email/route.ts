import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmailToken } from "@/lib/email-verification";

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = VerifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { token, email } = parsed.data;

  try {
    const result = await verifyEmailToken(token, email);
    return NextResponse.json(
      {
        success: true,
        message: "Email verified successfully!",
        user: result.user,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json(
      { error: message, code: "verification_failed" },
      { status: 400 },
    );
  }
}
