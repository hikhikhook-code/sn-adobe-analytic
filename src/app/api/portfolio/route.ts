import { NextResponse } from "next/server";
import { z } from "zod";
import { selectProvider, mockProvider } from "@/lib/providers";
import { ProviderNotImplementedError } from "@/lib/providers/types";

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
  const provider = selectProvider();
  try {
    return NextResponse.json(await provider.contributor(parsed.data.query));
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      console.warn(`[providers] ${err.message}`);
      return NextResponse.json(await mockProvider.contributor(parsed.data.query));
    }
    throw err;
  }
}
