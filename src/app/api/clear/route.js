import { NextResponse } from "next/server";
import scraper from "@/scraper/scraper";

export async function POST() {
  try {
    const job = await scraper.clearJob();
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
