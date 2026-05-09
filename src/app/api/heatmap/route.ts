import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runHeatmap } from "@/lib/providers";
import { resolveDatasetScope } from "@/lib/dataset-scope";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const scopeInfo = await resolveDatasetScope(userId);
  const result = await runHeatmap({ userId, datasetScope: scopeInfo.scope });
  return NextResponse.json({
    ...result,
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
  });
}
