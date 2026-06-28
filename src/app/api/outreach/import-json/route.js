import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SAVE_PATH = path.join(process.cwd(), "exports", "outreach_leads.json");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function loadLeads() {
  try {
    const data = await fs.readFile(SAVE_PATH, "utf8");
    return JSON.parse(data);
  } catch (_) {
    return [];
  }
}

async function saveLeads(leads) {
  try {
    await fs.mkdir(path.dirname(SAVE_PATH), { recursive: true });
    await fs.writeFile(SAVE_PATH, JSON.stringify(leads, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save outreach leads:", err);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const newLeads = body.leads || [];

    if (!Array.isArray(newLeads)) {
      return NextResponse.json(
        { ok: false, error: "Leads parameter must be an array" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const currentLeads = await loadLeads();
    const existingMap = new Map(currentLeads.map((l) => [l.profileUrl, l]));

    newLeads.forEach((l) => {
      if (!l.profileUrl) return; // Skip if no profile url
      const existing = existingMap.get(l.profileUrl);
      if (existing) {
        // Merge fields, overriding with new ones if present
        existingMap.set(l.profileUrl, { ...existing, ...l, socials: { ...existing.socials, ...l.socials } });
      } else {
        existingMap.set(l.profileUrl, l);
      }
    });

    const mergedLeads = Array.from(existingMap.values());
    await saveLeads(mergedLeads);

    return NextResponse.json({ ok: true, count: mergedLeads.length }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
