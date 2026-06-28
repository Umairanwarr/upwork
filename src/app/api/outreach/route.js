import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SAVE_PATH = path.join(process.cwd(), "exports", "outreach_leads.json");

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

export async function GET() {
  try {
    const leads = await loadLeads();
    return NextResponse.json({ ok: true, leads });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await saveLeads([]);
    return NextResponse.json({ ok: true, leads: [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
