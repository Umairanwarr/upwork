import { NextResponse } from "next/server";
import scraper from "@/scraper/scraper";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function generateCsv(data) {
  const headers = [
    "Name",
    "Title",
    "Profile URL",
    "Agency Name",
    "Agency URL",
    "Website",
    "LinkedIn",
    "Instagram",
    "Facebook",
    "Twitter",
    "YouTube",
    "GitHub",
    "Dribbble",
    "Behance",
  ];

  const escapeCsv = (val) => {
    if (!val) return '""';
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return '"' + str + '"';
  };

  const rows = data.map((lead) => {
    const socials = lead.socials || {};
    return [
      lead.name,
      lead.title,
      lead.profileUrl,
      lead.agencyName,
      lead.agencyUrl,
      lead.website,
      socials.linkedin || lead.linkedin,
      socials.instagram,
      socials.facebook,
      socials.twitter,
      socials.youtube,
      socials.github,
      socials.dribbble,
      socials.behance,
    ]
      .map(escapeCsv)
      .join(",");
  });

  return `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
}

export async function POST(request) {
  try {
    const body = await request.json();

    // When job is done, generate CSV content and store it in memory for download
    // (no filesystem write — download happens via /api/download in the browser)
    if (body.phase === "done" && body.data && body.data.length > 0) {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const filename = `upwork-leads-${timestamp}.csv`;
      body.csvFilename = filename;
      body.csvContent = generateCsv(body.data);
      body.downloadUrl = `/api/download`;
    }

    const job = await scraper.updateJob(body);
    return NextResponse.json({ ok: true, job }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
