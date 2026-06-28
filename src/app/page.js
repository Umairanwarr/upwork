"use client";

import { useState, useEffect, useRef } from "react";

// API fetch helper matching app.js
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    if (text.includes("Not found")) {
      throw new Error(
        "API not found — stop the old server and run npm start again.",
      );
    }
    throw new Error(`Server returned non-JSON: ${text.slice(0, 120)}`);
  }

  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }

  return payload.job;
}

// Simple, robust CSV Parser matching app.js
function parseCsv(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

function phaseLabel(phase) {
  return String(phase || "idle")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function triggerDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("find-leads");
  const [keyword, setKeyword] = useState("");
  const [maxPages, setMaxPages] = useState(1);
  const [outreachLeads, setOutreachLeads] = useState([]);
  const [extensionInstalled, setExtensionInstalled] = useState(false);

  useEffect(() => {
    const checkExtension = () => {
      if (document.documentElement.getAttribute('data-uw-extension-installed') === 'true' || window.__upworkScraperExtensionInstalled) {
        setExtensionInstalled(true);
        return true;
      }
      return false;
    };

    if (checkExtension()) return;

    const handleEvent = () => setExtensionInstalled(true);
    window.addEventListener('UPWORK_SCRAPER_EXTENSION_INSTALLED', handleEvent);

    const interval = setInterval(() => {
      if (checkExtension()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      window.removeEventListener('UPWORK_SCRAPER_EXTENSION_INSTALLED', handleEvent);
      clearInterval(interval);
    };
  }, []);

  const [job, setJob] = useState({
    running: false,
    phase: "idle",
    page: 0,
    total: 0,
    enrichedAgencies: 0,
    totalAgencies: 0,
    message: "Ready. Enter a keyword and click Search & Scrape.",
    statusType: "",
    upworkTabOpen: false,
    robotDetected: false,
    downloadUrl: "",
  });

  const isFirstLoad = useRef(true);
  const csvFileInputRef = useRef(null);

  // Poll scraper status on mount
  useEffect(() => {
    const refreshStatus = async () => {
      try {
        const updatedJob = await api("/api/status");
        if (updatedJob) {
          setJob(updatedJob);
        }
      } catch (error) {
        setJob((prev) => ({
          ...prev,
          phase: "error",
          running: false,
          message: error.message,
          statusType: "error",
        }));
      }
    };

    refreshStatus();
    const interval = setInterval(refreshStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Fetch outreach leads from API
  const fetchOutreachLeads = async () => {
    try {
      const res = await fetch("/api/outreach");
      const data = await res.json();
      if (data.ok) {
        setOutreachLeads(data.leads || []);
      }
    } catch (err) {
      console.warn("Could not fetch outreach leads:", err);
    }
  };

  // Poll outreach leads every 3 seconds to keep synced with extension posts
  useEffect(() => {
    fetchOutreachLeads();
    const interval = setInterval(fetchOutreachLeads, 3000);
    return () => clearInterval(interval);
  }, []);

  // Handle auto-downloads when job phase switches to 'done'
  const lastPhaseDoneId = useRef(null);
  useEffect(() => {
    if (job?.phase === "done" && job?.downloadUrl) {
      // Use a combination of phase+total as a unique key so repeated jobs each trigger a download
      const doneKey = `done-${job.total || 0}-${job.csvFilename || ""}`;
      if (doneKey !== lastPhaseDoneId.current && !isFirstLoad.current) {
        lastPhaseDoneId.current = doneKey;
        triggerDownload(job.downloadUrl);
      }
    }
    if (job) {
      isFirstLoad.current = false;
    }
  }, [job]);

  const handleStart = async () => {
    try {
      lastPhaseDoneId.current = null;
      const updatedJob = await api("/api/start", {
        method: "POST",
        body: JSON.stringify({
          keyword: keyword.trim(),
          maxPages: Number(maxPages || 1),
        }),
      });
      setJob(updatedJob);
      const searchUrl = `https://www.upwork.com/nx/search/talent/?loc=americas,antarctica,australia-and-new-zealand,europe&nbs=1&pt=agency&q=${encodeURIComponent(keyword.trim())}`;
      window.open(searchUrl, "_blank");
    } catch (error) {
      setJob((prev) => ({
        ...prev,
        phase: "error",
        running: false,
        message: error.message,
        statusType: "error",
      }));
    }
  };

  // Stop scraper job
  const handleStop = async () => {
    try {
      const updatedJob = await api("/api/stop", { method: "POST", body: "{}" });
      setJob(updatedJob);
    } catch (error) {
      setJob((prev) => ({
        ...prev,
        message: error.message,
        statusType: "error",
      }));
    }
  };

  // Clear scraper job
  const handleClear = async () => {
    try {
      const updatedJob = await api("/api/clear", { method: "POST", body: "{}" });
      setJob(updatedJob);
    } catch (error) {
      setJob((prev) => ({
        ...prev,
        message: error.message,
        statusType: "error",
      }));
    }
  };

  // Focus verification tab in Chrome
  const handleFocusUpwork = async () => {
    try {
      const updatedJob = await api("/api/focus-upwork", { method: "POST", body: "{}" });
      setJob(updatedJob);
    } catch (error) {
      setJob((prev) => ({
        ...prev,
        message: error.message,
        statusType: "error",
      }));
    }
  };

  // Trigger file upload for CSV import
  const handleImportCsvClick = () => {
    if (csvFileInputRef.current) {
      csvFileInputRef.current.click();
    }
  };

  // Parse and save uploaded CSV file to API
  const handleCsvChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const parsedLines = parseCsv(text);
        if (parsedLines.length < 2) {
          alert("CSV file seems empty or invalid.");
          return;
        }

        const headers = parsedLines[0];
        const dataRows = parsedLines.slice(1).filter(
          (row) => row.length > 0 && row.some((val) => val.trim() !== "")
        );

        const headerIndices = {};
        headers.forEach((h, idx) => {
          headerIndices[h.replace(/^\uFEFF/, "").trim().toLowerCase()] = idx;
        });

        const getVal = (row, fieldName) => {
          const idx = headerIndices[fieldName];
          return idx !== undefined && row[idx] ? row[idx].trim() : "";
        };

        const parsedLeads = dataRows.map((row) => {
          const name = getVal(row, "name");
          const title = getVal(row, "title");
          const profileUrl = getVal(row, "profile url") || getVal(row, "profileurl") || getVal(row, "profile");
          const agencyName = getVal(row, "agency name") || getVal(row, "agencyname") || getVal(row, "agency");
          const agencyUrl = getVal(row, "agency url") || getVal(row, "agencyurl");
          const website = getVal(row, "website");
          const linkedin = getVal(row, "linkedin");

          const socials = {};
          const checkSocial = (fieldName) => {
            const url = getVal(row, fieldName);
            if (url && url.startsWith("http")) {
              socials[fieldName] = url;
            }
          };

          if (linkedin) socials.linkedin = linkedin;
          checkSocial("instagram");
          checkSocial("facebook");
          checkSocial("twitter");
          checkSocial("youtube");
          checkSocial("github");
          checkSocial("dribbble");
          checkSocial("behance");

          return {
            name,
            title,
            profileUrl,
            agencyName,
            agencyUrl,
            website,
            socials,
          };
        });

        const res = await fetch("/api/outreach/import-json", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leads: parsedLeads }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.ok) {
          fetchOutreachLeads();
        } else {
          throw new Error(data.error || "Failed to save leads");
        }
      } catch (err) {
        alert("Error parsing CSV file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset input
  };

  // Clear outreach lead list
  const handleClearOutreach = async () => {
    try {
      const res = await fetch("/api/outreach", { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setOutreachLeads([]);
      } else {
        throw new Error(data.error || "Failed to clear leads");
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  // Map dynamic connection pill attributes
  let connectionLabel = "Idle";
  let connectionClass = "";
  if (job?.phase === "error") {
    connectionLabel = "Error";
    connectionClass = "error";
  } else if (job?.robotDetected) {
    connectionLabel = "Verify robot";
    connectionClass = "robot";
  } else if (job?.running) {
    connectionLabel = "Running";
    connectionClass = "running";
  } else if (job?.phase === "done") {
    connectionLabel = "Done";
    connectionClass = "";
  }

  // Helper for message-card background class
  const getMessageClass = () => {
    if (job?.statusType === "success") return "success";
    if (job?.statusType === "error") return "error";
    if (job?.statusType === "warning") return "warning";
    return "";
  };

  // Render outreach leads to UI
  const renderOutreachRows = () => {
    if (!outreachLeads || outreachLeads.length === 0) {
      return (
        <tr>
          <td colSpan={7} className="empty">
            No leads imported. Click "Import CSV" to upload a CSV file or send them from the Upwork Chrome Extension.
          </td>
        </tr>
      );
    }

    return outreachLeads.map((lead, rowIdx) => {
      const { name, title, profileUrl, agencyName, agencyUrl, website, socials = {} } = lead;

      // Other socials list
      const socialsList = [];
      const checkSocial = (fieldName, label) => {
        const url = socials[fieldName];
        if (url && url.startsWith("http")) {
          socialsList.push({ url, label });
        }
      };
      checkSocial("instagram", "IG");
      checkSocial("facebook", "FB");
      checkSocial("twitter", "X");
      checkSocial("youtube", "YT");
      checkSocial("github", "GH");
      checkSocial("dribbble", "DR");
      checkSocial("behance", "BE");

      return (
        <tr key={rowIdx}>
          <td>{name || "-"}</td>
          <td>{title || "-"}</td>
          <td>
            {agencyName ? (
              agencyUrl && agencyUrl.startsWith("http") ? (
                <a href={agencyUrl} target="_blank" rel="noopener noreferrer">
                  {agencyName}
                </a>
              ) : (
                agencyName
              )
            ) : (
              "-"
            )}
          </td>
          <td>
            {website && website.startsWith("http") ? (
              <a href={website} target="_blank" rel="noopener noreferrer">
                Website
              </a>
            ) : (
              "-"
            )}
          </td>
          <td>
            {socials.linkedin && socials.linkedin.startsWith("http") ? (
              <a href={socials.linkedin} target="_blank" rel="noopener noreferrer">
                LinkedIn
              </a>
            ) : (
              "-"
            )}
          </td>
          <td>
            {profileUrl && profileUrl.startsWith("http") ? (
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                Profile
              </a>
            ) : (
              "-"
            )}
          </td>
          <td>
            {socialsList.length > 0 ? (
              socialsList.map((soc, sIdx) => (
                <a
                  key={sIdx}
                  href={soc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginRight: "6px", fontWeight: "500" }}
                >
                  {soc.label}
                </a>
              ))
            ) : (
              "-"
            )}
          </td>
        </tr>
      );
    });
  };

  const getOutreachSummary = () => {
    if (!outreachLeads || outreachLeads.length === 0) {
      return "No leads imported yet.";
    }
    const count = outreachLeads.length;
    return `Imported ${count} lead${count === 1 ? "" : "s"} successfully.`;
  };

  return (
    <>
      {/* ── Top nav ── */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div className="brand-name">LeadUpwork</div>
              <div className="brand-sub">Find and engage leads from Upwork.</div>
            </div>
          </div>

          <div className={`status-pill ${connectionClass}`} id="connectionState">
            <span className="status-dot"></span>
            <span className="status-label">{connectionLabel}</span>
          </div>
        </div>
      </header>

      <div className="page">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "find-leads" ? "active" : ""}`}
            onClick={() => setActiveTab("find-leads")}
          >
            Find Leads
          </button>
          <button
            className={`tab ${activeTab === "outreach" ? "active" : ""}`}
            onClick={() => setActiveTab("outreach")}
          >
            Outreach
          </button>
        </div>

        {/* ── Search card ── */}
        <div
          className="card search-card"
          id="viewFindLeads"
          style={{ display: activeTab === "find-leads" ? "flex" : "none" }}
        >
          {!extensionInstalled && (
            <div style={{
              background: "#fff2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              padding: "12px 16px",
              borderRadius: "8px",
              marginBottom: "16px",
              fontSize: "14px",
              fontWeight: "500",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>
                <strong>Chrome Extension Not Detected:</strong> Please load and enable the <strong>Upwork Talent Scraper</strong> extension in Chrome to perform searches.
              </span>
            </div>
          )}
          <div className="search-row">
            <div className="search-input-wrap">
              <svg
                className="search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="keyword"
                type="text"
                className="search-input"
                placeholder="Search service…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-row">
            <div className="filter-group">
              <label className="filter-label">Max Pages</label>
              <input
                id="maxPages"
                type="number"
                className="filter-input"
                min="1"
                max="500"
                value={maxPages}
                onChange={(e) => setMaxPages(Math.max(1, Number(e.target.value)))}
              />
            </div>

            <button
              className="btn btn-primary"
              id="startBtn"
              onClick={handleStart}
              disabled={Boolean(job?.running) || !extensionInstalled}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search &amp; Scrape
            </button>
            <button
              className="btn btn-ghost"
              id="stopBtn"
              onClick={handleStop}
              disabled={!job?.running}
            >
              Stop
            </button>
            <button
              className="btn btn-danger-ghost"
              id="clearBtn"
              onClick={handleClear}
              disabled={Boolean(job?.running)}
            >
              Clear
            </button>
            <button
              className="btn btn-ghost"
              id="focusUpworkBtn"
              onClick={handleFocusUpwork}
              disabled={!job?.upworkTabOpen && !job?.running}
            >
              Open Upwork Tab
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value" id="leadCount">
                {job?.total || job?.data?.length || 0}
              </div>
              <div className="stat-label">Profiles collected</div>
            </div>
            <div className="stat-card">
              <div className="stat-value accent" id="scrapeState">
                {phaseLabel(job?.phase)}
              </div>
              <div className="stat-label">Current phase</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" id="pageCount">
                {job?.page || 0}
              </div>
              <div className="stat-label">Page</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" id="agencyCount">
                {`${job?.enrichedAgencies || 0}/${job?.totalAgencies || 0}`}
              </div>
              <div className="stat-label">Agencies enriched</div>
            </div>
          </div>

          <div className={`message-card ${getMessageClass()}`} id="message">
            {job?.message || "Ready. Enter a keyword and click Search & Scrape."}
          </div>
        </div>

        {/* ── Outreach card ── */}
        <div
          className="card table-card"
          id="viewOutreach"
          style={{ display: activeTab === "outreach" ? "block" : "none" }}
        >
          <div className="table-header">
            <div>
              <div className="table-title">Outreach Lead List</div>
              <div className="table-sub" id="outreachCount">
                {getOutreachSummary()}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="file"
                id="csvFileInput"
                accept=".csv"
                style={{ display: "none" }}
                ref={csvFileInputRef}
                onChange={handleCsvChange}
              />
              <button className="btn btn-primary" id="importCsvBtn" onClick={handleImportCsvClick}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  style={{ marginRight: "4px" }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import CSV
              </button>
              <button className="btn btn-danger-ghost" id="clearOutreachBtn" onClick={handleClearOutreach}>
                Clear
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Agency</th>
                  <th>Website</th>
                  <th>LinkedIn</th>
                  <th>Profile</th>
                  <th>Socials</th>
                </tr>
              </thead>
              <tbody id="outreachTableBody">{renderOutreachRows()}</tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
