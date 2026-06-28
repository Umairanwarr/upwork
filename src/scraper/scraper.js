// In-memory state store for Extension-Driven Mode
if (!global.scraperJob) {
  global.scraperJob = createEmptyJob();
}
let job = global.scraperJob;

function createEmptyJob() {
  return {
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

function resetJob() {
  for (const key in job) {
    delete job[key];
  }
  Object.assign(job, createEmptyJob());
}

function startScrape({ keyword, maxPages }) {
  resetJob();
  job.id = Date.now().toString(36);
  job.keyword = String(keyword || "").trim();
  job.maxPages = Number(maxPages || 1);
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.phase = "starting";
  job.message = "Opening Upwork tab... Please keep the tab open.";
  job.downloadUrl = `/api/download`;
  return publicJob();
}

function stopScrape() {
  job.shouldStop = true;
  job.running = false;
  if (job.phase !== "done" && job.phase !== "error") job.phase = "stopped";
  job.message = "Stopped by user.";
  job.statusType = "warning";
  return publicJob();
}

function clearJob() {
  resetJob();
  return publicJob();
}

function focusVerificationTab() {
  // No-op in extension-driven mode
  return publicJob();
}

function publicJob() {
  return {
    ...job,
    data: job.data ? job.data.slice(-200) : [],
  };
}

function updateJob(updates) {
  Object.assign(job, updates);
  return publicJob();
}

module.exports = {
  startScrape,
  stopScrape,
  clearJob,
  focusVerificationTab,
  getStatus: publicJob,
  updateJob,
};
