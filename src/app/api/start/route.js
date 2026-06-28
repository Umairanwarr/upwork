import { NextResponse } from "next/server";
import scraper from "@/scraper/scraper";

export async function POST(request) {
  try {
    const body = await request.json();
    const job = scraper.startScrape({
      keyword: body.keyword,
      maxPages: body.maxPages,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
