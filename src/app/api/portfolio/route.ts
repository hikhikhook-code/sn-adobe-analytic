import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { selectProvider } from "@/lib/providers";
import { resolveDatasetScope } from "@/lib/dataset-scope";
import { requireEntitlement } from "@/lib/entitlement-gate";
import {
  parseContributorInput,
  isNumericContributorLookup,
} from "@/lib/portfolio-input";
import {
  ProviderFeatureUnsupportedError,
  ProviderNoDataError,
  ProviderNotImplementedError,
  ProviderRequiresUserError,
} from "@/lib/providers/types";

const PortfolioSchema = z.object({
  query: z.string().min(1).max(200),
});

/**
 * POST /api/portfolio — contributor lookup.
 *
 * PR #20 QA fix:
 *   1. The request body may be a pasted URL like
 *      `https://stock.adobe.com/uk/search/images?creator_id=203204060`.
 *      `parseContributorInput` now understands that shape and extracts
 *      the numeric id; we forward that id to the provider.
 *   2. When the user searches by a numeric id (plain id, /contributor
 *      URL, or creator_id search URL), we do NOT let the mock provider
 *      synthesize a demo contributor as a fallback. Every numeric id
 *      would otherwise appear to have a real Adobe portfolio, which is
 *      exactly the "data honesty" line this codebase is built around.
 *      Instead, we return a structured 404 with a friendly "no data"
 *      message so the UI can render a clean unsupported-state rather
 *      than a raw 400.
 *
 * For free-text name lookups we keep the prior mock-fallback semantics
 * because the mock generator produces a deterministic demo contributor
 * keyed off the name — that's what powers the "try the app with
 * `business` or `nature`" demo experience.
 */
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

  // PRD §7: Portfolio Tracker is Pro/Annual. Owners bypass.
  const gate = await requireEntitlement("canUsePortfolioTracker", {
    requireSignedIn: true,
  });
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const parsedInput = parseContributorInput(parsed.data.query);
  if (!parsedInput) {
    return NextResponse.json(
      { error: "Invalid input" },
      { status: 400 },
    );
  }

  // The portfolio page doesn't expose an inline scope picker; it always
  // respects the user's stored preference. If they're looking at demo
  // data globally, they see demo contributor data here too — keeps the
  // cross-app semantics consistent.
  const scopeInfo = await resolveDatasetScope(userId);
  const ctx = { userId, datasetScope: scopeInfo.scope };
  const numericLookup = isNumericContributorLookup(parsedInput);

  // Run the active provider directly (no `runProvider` fallback wrapper)
  // so we can emit a clean "not found in your imported data" response
  // for numeric lookups instead of the generic mock fallback that
  // fabricates a demo contributor. Free-text name lookups still fall
  // back to mock below so the demo experience continues to work.
  const provider = await selectProvider(ctx);

  // Short-circuit: numeric lookups against the mock provider are
  // always "no data" — the mock generator happily synthesizes a
  // portfolio for *any* query string, including a random numeric id.
  // Returning that demo result would imply we have real data for the
  // creator_id the user pasted, which is exactly the "data honesty"
  // line the PRD draws. Bail out with a structured 404 instead.
  if (numericLookup && provider.id === "mock") {
    return NextResponse.json(
      {
        error: "contributor_not_found",
        message:
          parsedInput.kind === "creator_id"
            ? "Creator-id lookups from stock.adobe.com URLs need a data source that can resolve the id. Import a CSV that includes this contributor, or search by contributor name on demo data."
            : "Numeric contributor-ID lookups need a data source that can resolve the id. Import a CSV that includes this contributor, or search by contributor name on demo data.",
        providerName: provider.name,
        providerId: provider.id,
        lookup: parsedInput.kind,
        hasAnyDatasets: scopeInfo.hasAnyDatasets,
      },
      { status: 404 },
    );
  }

  try {
    const result = await provider.contributor(parsedInput.value, ctx);
    return NextResponse.json({
      ...result,
      providerId: result.providerId ?? provider.id,
      providerName: result.providerName ?? provider.name,
      capabilities: result.capabilities ?? provider.capabilities,
      dataQuality: result.dataQuality ?? provider.dataQuality,
      datasetScope: scopeInfo.scope,
      datasetName: scopeInfo.datasetName ?? null,
      scopeReason: scopeInfo.reason,
      hasAnyDatasets: scopeInfo.hasAnyDatasets,
    });
  } catch (err) {
    if (err instanceof ProviderNoDataError) {
      // User has imported data but no matching contributor. For numeric
      // lookups we STOP here — a fake mock portfolio for a random id
      // would be worse than no data. For free-text names we fall through
      // to the mock fallback below.
      if (numericLookup) {
        return NextResponse.json(
          {
            error: "contributor_not_found",
            message:
              parsedInput.kind === "creator_id"
                ? "We couldn't find a contributor with that creator_id in your imported data. Portfolio Tracker currently supports Adobe Stock creator_id URLs only when the contributor appears in a CSV you've imported."
                : "We couldn't find that contributor ID in your imported data. Try searching by contributor name, or import a CSV that includes this contributor.",
            providerName: provider.name,
            providerId: provider.id,
            lookup: parsedInput.kind,
          },
          { status: 404 },
        );
      }
      // Fall through to mock for free-text name lookups.
    } else if (err instanceof ProviderFeatureUnsupportedError) {
      return NextResponse.json(
        {
          error: "provider_feature_unsupported",
          message:
            "The active data provider does not support contributor lookup.",
          providerName: provider.name,
          providerId: provider.id,
        },
        { status: 501 },
      );
    } else if (
      !(err instanceof ProviderRequiresUserError) &&
      !(err instanceof ProviderNotImplementedError)
    ) {
      throw err;
    }
    // ProviderRequiresUserError / ProviderNotImplementedError / name-lookup
    // ProviderNoDataError — fall through to mock for the demo experience.
  }

  // Numeric-lookup fallbacks were handled above. Below is the
  // free-text name path: use mock so "business" / "nature" / etc.
  // demos still work out of the box.
  if (numericLookup) {
    // Should not reach here, but be defensive: if something threw a
    // non-NoData error above we already returned. Anything that didn't
    // throw is handled in the try block's early return.
    return NextResponse.json(
      {
        error: "contributor_not_found",
        message:
          "No matching contributor found. Try a different id or import a CSV that includes this contributor.",
        providerName: provider.name,
        providerId: provider.id,
        lookup: parsedInput.kind,
      },
      { status: 404 },
    );
  }

  const { mockProvider } = await import("@/lib/providers");
  const mockResult = await mockProvider.contributor(parsedInput.value, ctx);
  return NextResponse.json({
    ...mockResult,
    providerId: mockResult.providerId ?? mockProvider.id,
    providerName: mockResult.providerName ?? mockProvider.name,
    capabilities: mockResult.capabilities ?? mockProvider.capabilities,
    dataQuality: mockResult.dataQuality ?? mockProvider.dataQuality,
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
  });
}
