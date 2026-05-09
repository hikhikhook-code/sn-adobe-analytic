import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runContributor } from "@/lib/providers";
import { resolveDatasetScope } from "@/lib/dataset-scope";

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
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  // The portfolio page doesn't expose an inline scope picker; it always
  // respects the user's stored preference. If they're looking at demo
  // data globally, they see demo contributor data here too — keeps the
  // cross-app semantics consistent.
  const scopeInfo = await resolveDatasetScope(userId);
  const result = await runContributor(parsed.data.query, {
    userId,
    datasetScope: scopeInfo.scope,
  });
  return NextResponse.json({
    ...result,
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
    // result already carries providerId, capabilities, and notice via the
    // ProviderResultEnvelope; spreading above forwards them. Listed here
    // as a reminder that the portfolio page reads these to render its
    // partial-supported state when the official provider isn't configured.
  });
}
