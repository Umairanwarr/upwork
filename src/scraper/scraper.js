// Scraper state store — backed by MongoDB so state persists across Vercel serverless calls.
// All functions are async (read/write to DB).

import clientPromise from "@/lib/mongodb";

const DB_NAME = "upwork_scraper";
const COLLECTION = "job";
const JOB_ID = "singleton"; // We only ever have one active job document

async function getCollection() {
  const client = await clientPromise;
  return client.db(DB_NAME).collection(COLLECTION);
}

function createEmptyJob() {
  return {
    _id: JOB_ID,
    id: null,
    keyword: "",
    tabId: null,
    phase: "idle",
    running: false,
    shouldStop: false,
    message: "Ready.",
    statusType: "info",
    page: 0,
    maxPages: 1,
    total: 0,
    enrichedAgencies: 0,
    totalAgencies: 0,
    robotDetected: false,
    upworkTabOpen: false,
    data: [],
    downloadUrl: "",
    csvContent: "",
    csvFilename: "",
    error: "",
    startedAt: null,
    finishedAt: null,
  };
}

function publicJob(job) {
  if (!job) job = createEmptyJob();
  const { _id, ...rest } = job;
  return {
    ...rest,
    data: Array.isArray(rest.data) ? rest.data.slice(-200) : [],
  };
}

async function getJob() {
  const col = await getCollection();
  const job = await col.findOne({ _id: JOB_ID });
  return job || createEmptyJob();
}

export async function getStatus() {
  const job = await getJob();
  return publicJob(job);
}

export async function startScrape({ keyword, maxPages }) {
  const col = await getCollection();
  const fresh = {
    ...createEmptyJob(),
    id: Date.now().toString(36),
    keyword: String(keyword || "").trim(),
    maxPages: Number(maxPages || 1),
    running: true,
    startedAt: new Date().toISOString(),
    phase: "starting",
    message: "Opening Upwork tab... Please keep the tab open.",
    downloadUrl: "/api/download",
  };
  await col.replaceOne({ _id: JOB_ID }, fresh, { upsert: true });
  return publicJob(fresh);
}

export async function stopScrape() {
  const col = await getCollection();
  const job = await getJob();
  const updated = {
    ...job,
    shouldStop: true,
    running: false,
    phase: job.phase !== "done" && job.phase !== "error" ? "stopped" : job.phase,
    message: "Stopped by user.",
    statusType: "warning",
  };
  await col.replaceOne({ _id: JOB_ID }, updated, { upsert: true });
  return publicJob(updated);
}

export async function clearJob() {
  const col = await getCollection();
  const fresh = createEmptyJob();
  await col.replaceOne({ _id: JOB_ID }, fresh, { upsert: true });
  return publicJob(fresh);
}

export async function focusVerificationTab() {
  // No-op in extension-driven mode
  return getStatus();
}

export async function updateJob(updates) {
  const col = await getCollection();
  const job = await getJob();
  const updated = { ...job, ...updates };
  await col.replaceOne({ _id: JOB_ID }, updated, { upsert: true });
  return publicJob(updated);
}

// Default export for backward compat with API routes that do: import scraper from "@/scraper/scraper"
const scraper = {
  getStatus,
  startScrape,
  stopScrape,
  clearJob,
  focusVerificationTab,
  updateJob,
};

export default scraper;
