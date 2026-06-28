// MongoDB connection helper — reuses a single connection across serverless invocations
// (Next.js caches module-level variables within the same Lambda container)

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "Please define the MONGODB_URI environment variable in .env.local"
  );
}

let client;
let clientPromise;

if (process.env.NODE_ENV === "development") {
  // In development, reuse the connection across hot-reloads
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // In production (Vercel), create a new connection per cold start
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;
