import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "upwork_scraper";
const COLLECTION = "outreach_leads";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function getCollection() {
  const client = await clientPromise;
  return client.db(DB_NAME).collection(COLLECTION);
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

    const col = await getCollection();

    // Upsert each lead by profileUrl
    const ops = newLeads
      .filter((l) => l.profileUrl)
      .map((l) => ({
        updateOne: {
          filter: { profileUrl: l.profileUrl },
          update: { $set: l },
          upsert: true,
        },
      }));

    if (ops.length > 0) {
      await col.bulkWrite(ops);
    }

    const total = await col.countDocuments();
    return NextResponse.json({ ok: true, count: total }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
