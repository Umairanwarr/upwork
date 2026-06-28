import { NextResponse } from "next/server";
import scraper from "@/scraper/scraper";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, job: scraper.getStatus() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
