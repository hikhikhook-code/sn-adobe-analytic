import { NextResponse } from "next/server";
import { TRENDING_KEYWORDS } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({ trending: TRENDING_KEYWORDS });
}
