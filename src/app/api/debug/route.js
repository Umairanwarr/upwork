import { NextResponse } from "next/server";

export async function GET() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    return NextResponse.json({ error: "MONGODB_URI is not set in environment variables" }, { status: 500 });
  }

  // Mask password for safe display
  const masked = uri.replace(/:([^@]+)@/, ":<PASSWORD_HIDDEN>@");

  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri);
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    await client.close();
    return NextResponse.json({ ok: true, uri: masked, message: "MongoDB connected successfully!" });
  } catch (e) {
    return NextResponse.json({ ok: false, uri: masked, error: e.message }, { status: 500 });
  }
}
