import { NextResponse } from "next/server";
import { HEATMAP_NICHES } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({ niches: HEATMAP_NICHES });
}
