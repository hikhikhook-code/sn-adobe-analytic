import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runHeatmap } from "@/lib/providers";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  return NextResponse.json(await runHeatmap({ userId }));
}
