import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "upwork_scraper";
const COLLECTION = "outreach_leads";

async function getCollection() {
  const client = await clientPromise;
  return client.db(DB_NAME).collection(COLLECTION);
}

export async function GET() {
  try {
    const col = await getCollection();
    const leads = await col.find({}).toArray();
    // Remove MongoDB _id from each lead before returning
    const cleaned = leads.map(({ _id, ...rest }) => rest);
    return NextResponse.json({ ok: true, leads: cleaned });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const col = await getCollection();
    await col.deleteMany({});
    return NextResponse.json({ ok: true, leads: [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
