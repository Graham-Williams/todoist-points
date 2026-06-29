import { NextResponse } from "next/server";
import { getStats } from "@/lib/queries";

// GET: dashboard stats (balance, totals, recent activity).
export async function GET() {
  return NextResponse.json(getStats());
}
