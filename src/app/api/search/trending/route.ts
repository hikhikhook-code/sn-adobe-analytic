import { NextResponse } from "next/server";
import { selectProvider, mockProvider } from "@/lib/providers";
import { ProviderNotImplementedError } from "@/lib/providers/types";

export async function GET() {
  const provider = selectProvider();
  try {
    return NextResponse.json(await provider.trending());
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      console.warn(`[providers] ${err.message}`);
      return NextResponse.json(await mockProvider.trending());
    }
    throw err;
  }
}
