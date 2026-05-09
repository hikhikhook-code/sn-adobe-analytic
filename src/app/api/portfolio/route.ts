import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMockContributor } from "@/lib/mock-data";

const PortfolioSchema = z.object({
  query: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PortfolioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  return NextResponse.json(generateMockContributor(parsed.data.query));
}
