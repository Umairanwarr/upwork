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

  // Authentication State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Navigation State
  const [sidebarTab, setSidebarTab] = useState("Upwork");
  const [platformsExpanded, setPlatformsExpanded] = useState(true);

  // Status updates queue ref to prevent race condition toggling
  const localStatusChanges = useRef({});

  // Date Filter State
  const [dateFilter, setDateFilter] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Load auth state from localStorage on mount (SSR safe)
  useEffect(() => {
    const logged = localStorage.getItem("leadupwork_logged_in") === "true";
    setIsLoggedIn(logged);
    setIsLoadingAuth(false);
  }, []);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (usernameInput.trim() === "Kamran Shah" && passwordInput === "Recipe@321") {
      setIsLoggedIn(true);
      localStorage.setItem("leadupwork_logged_in", "true");
      setLoginError("");
    } else {
      setLoginError("Invalid username or password");
    }
  };

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
    if (!isLoggedIn) return;
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
  }, [isLoggedIn]);

  // Fetch outreach leads from API
  const fetchOutreachLeads = async () => {
    try {
      const res = await fetch("/api/outreach");
      const data = await res.json();
      if (data.ok) {
        const serverLeads = data.leads || [];
        // Merge with local status overrides to avoid polling overrides
        const mergedLeads = serverLeads.map((lead) => {
          const localStatus = localStatusChanges.current[lead.profileUrl];
          if (localStatus !== undefined) {
            if (lead.status === localStatus) {
              delete localStatusChanges.current[lead.profileUrl];
            } else {
              return { ...lead, status: localStatus };
            }
          }
          return lead;
        });
        setOutreachLeads(mergedLeads);
      }
    } catch (err) {
      console.warn("Could not fetch outreach leads:", err);
    }
  };

  // Poll outreach leads every 3 seconds to keep synced with extension posts
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchOutreachLeads();
    const interval = setInterval(fetchOutreachLeads, 3000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  // Handle auto-downloads when job phase switches to 'done'
  const lastPhaseDoneId = useRef(null);
  useEffect(() => {
    if (!isLoggedIn) return;
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
  }, [job, isLoggedIn]);

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
      const searchUrl = `https://www.upwork.com/nx/search/talent/?loc=australia,canada,germany,united-kingdom,united-states&nbs=1&pt=agency&q=${encodeURIComponent(keyword.trim())}`;
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
  const handleCsvChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const readFilePromise = (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const text = evt.target.result;
            const parsedLines = parseCsv(text);
            if (parsedLines.length < 2) {
              resolve([]);
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

            resolve(parsedLeads);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    };

    try {
      const results = await Promise.all(files.map(file => readFilePromise(file)));
      const combinedLeads = results.flat();

      if (combinedLeads.length === 0) {
        alert("No valid leads found in the selected CSV files.");
        return;
      }

      const res = await fetch("/api/outreach/import-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ leads: combinedLeads }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        fetchOutreachLeads();
      } else {
        throw new Error(data.error || "Failed to save leads");
      }
    } catch (err) {
      alert("Error parsing CSV files: " + err.message);
    }
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

  const getStatusStyles = (status) => {
    switch (status) {
      case "Contacted":
        return { color: "#2563eb", background: "#eff6ff", borderColor: "#bfdbfe" };
      case "Replied":
        return { color: "#4f46e5", background: "#f5f3ff", borderColor: "#ddd6fe" };
      case "Interested":
        return { color: "#16a34a", background: "#f0fdf4", borderColor: "#bbf7d0" };
      case "Follow Up Needed":
        return { color: "#d97706", background: "#fffbeb", borderColor: "#fde68a" };
      case "Closed":
        return { color: "#dc2626", background: "#fef2f2", borderColor: "#fecaca" };
      default: // "Not Contacted"
        return { color: "#4b5563", background: "#f3f4f6", borderColor: "#e5e7eb" };
    }
  };

  const handleStatusChange = async (profileUrl, newStatus) => {
    localStatusChanges.current[profileUrl] = newStatus;

    setOutreachLeads((prev) =>
      prev.map((lead) =>
        lead.profileUrl === profileUrl ? { ...lead, status: newStatus } : lead
      )
    );

    try {
      const res = await fetch("/api/outreach", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileUrl, status: newStatus }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to update status");
      }
    } catch (err) {
      console.error("Error updating lead status:", err);
      alert("Failed to save status: " + err.message);
      fetchOutreachLeads();
    }
  };

  const getFilteredLeads = () => {
    let filtered = [...outreachLeads];

    if (dateFilter !== "all") {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      filtered = filtered.filter((lead) => {
        const leadDate = lead.createdAt ? new Date(lead.createdAt) : new Date();

        if (dateFilter === "today") {
          return leadDate >= startOfDay;
        } else if (dateFilter === "7days") {
          const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000);
          return leadDate >= sevenDaysAgo;
        } else if (dateFilter === "30days") {
          const thirtyDaysAgo = new Date(startOfDay.getTime() - 30 * 24 * 60 * 60 * 1000);
          return leadDate >= thirtyDaysAgo;
        } else if (dateFilter === "custom") {
          if (!customStartDate && !customEndDate) return true;
          let keep = true;
          if (customStartDate) {
            const start = new Date(customStartDate);
            keep = keep && leadDate >= start;
          }
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            keep = keep && leadDate <= end;
          }
          return keep;
        }
        return true;
      });
    }

    // Sort descending by date added
    filtered.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
      const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
      return dateB - dateA;
    });

    return filtered;
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
  const renderOutreachRows = (leadsToRender) => {
    if (!leadsToRender || leadsToRender.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="empty">
            No leads match the selected criteria. Click "Import CSV" to upload a CSV file or send them from the Upwork Chrome Extension.
          </td>
        </tr>
      );
    }

    return leadsToRender.map((lead, rowIdx) => {
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
          <td>
            <select
              value={lead.status || "Not Contacted"}
              onChange={(e) => handleStatusChange(profileUrl, e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid",
                fontFamily: "inherit",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                outline: "none",
                transition: "all 0.15s",
                ...getStatusStyles(lead.status || "Not Contacted")
              }}
            >
              <option value="Not Contacted" style={{ color: "#4b5563", background: "#ffffff" }}>Not Contacted</option>
              <option value="Contacted" style={{ color: "#2563eb", background: "#ffffff" }}>Contacted</option>
              <option value="Replied" style={{ color: "#4f46e5", background: "#ffffff" }}>Replied</option>
              <option value="Interested" style={{ color: "#16a34a", background: "#ffffff" }}>Interested</option>
              <option value="Follow Up Needed" style={{ color: "#d97706", background: "#ffffff" }}>Follow Up Needed</option>
              <option value="Closed" style={{ color: "#dc2626", background: "#ffffff" }}>Closed</option>
            </select>
          </td>
        </tr>
      );
    });
  };

  const getOutreachSummary = (filteredCount) => {
    if (!outreachLeads || outreachLeads.length === 0) {
      return "No leads imported yet.";
    }
    const totalCount = outreachLeads.length;
    if (dateFilter !== "all") {
      return `Showing ${filteredCount} of ${totalCount} lead${totalCount === 1 ? "" : "s"}.`;
    }
    return `Imported ${totalCount} lead${totalCount === 1 ? "" : "s"} successfully.`;
  };

  // Auth Loading View
  if (isLoadingAuth) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0f172a" }}>
        <div style={{ color: "#ffffff", fontSize: "16px", fontWeight: "600", fontFamily: "sans-serif" }}>Loading...</div>
      </div>
    );
  }

  // Login Form View
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">O</div>
          <h1 className="login-title">Outreach Hub</h1>
          <p className="login-subtitle">Sign in to manage your scraping integrations</p>
          
          <form className="login-form" onSubmit={handleLoginSubmit}>
            {loginError && (
              <div className="login-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>{loginError}</span>
              </div>
            )}
            
            <div className="form-group">
              <label className="login-label">Username</label>
              <input
                type="text"
                className="login-input"
                placeholder="Enter username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label className="login-label">Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="login-input"
                  placeholder="Enter password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  style={{ paddingRight: "40px" }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    outline: "none"
                  }}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            
            <button type="submit" className="btn-login">
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Logged-in Sidebar + Platform Views
  return (
    <div className="app-container">
      {/* ── Left Sidebar ── */}
      <aside className="sidebar">
        <div>
          {/* Header */}
          <div className="sidebar-header">
            <div className="sidebar-logo">O</div>
            <div className="sidebar-brand-name">Outreach Hub</div>
          </div>

          {/* Menu */}
          <nav className="sidebar-menu">
            <button
              className={`menu-item-btn ${sidebarTab === "Dashboard" ? "active" : ""}`}
              onClick={() => setSidebarTab("Dashboard")}
            >
              <span className="menu-item-link-wrap">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9"></rect>
                  <rect x="14" y="3" width="7" height="5"></rect>
                  <rect x="14" y="12" width="7" height="9"></rect>
                  <rect x="3" y="16" width="7" height="5"></rect>
                </svg>
                <span>Dashboard</span>
              </span>
            </button>

            <div>
              <button
                className="menu-item-btn"
                onClick={() => setPlatformsExpanded(!platformsExpanded)}
              >
                <span className="menu-item-link-wrap">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                    <polyline points="2 17 12 22 22 17"></polyline>
                    <polyline points="2 12 12 17 22 12"></polyline>
                  </svg>
                  <span>Platforms</span>
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{
                    transform: platformsExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s"
                  }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {platformsExpanded && (
                <div className="submenu-list">
                  {["Upwork", "Fiverr", "Clutch", "LinkedIn", "Freelancer.com", "Contra", "Telegram", "Discord"].map((plat) => (
                    <button
                      key={plat}
                      className={`submenu-item-btn ${sidebarTab === plat ? "active" : ""}`}
                      onClick={() => setSidebarTab(plat)}
                    >
                      {plat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="profile-avatar">KS</div>
          <div className="profile-info">
            <span className="profile-name">Kamran Shah</span>
          </div>
          <button
            className="logout-btn-icon"
            title="Log Out"
            onClick={() => {
              setIsLoggedIn(false);
              localStorage.removeItem("leadupwork_logged_in");
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div className="main-content">
        {sidebarTab === "Upwork" && (
          <>
            {/* ── Top nav ── */}
            <header className="topbar">
              <div className="topbar-inner">
                <div className="brand">
                  <div className="brand-name">Upwork Integration</div>
                  <div className="brand-sub">Find and engage leads from Upwork.</div>
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
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
                      {getOutreachSummary(getFilteredLeads().length)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-2)" }}>Filter:</span>
                      <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        style={{
                          height: "36px",
                          padding: "0 10px",
                          border: "1px solid var(--border-mid)",
                          borderRadius: "7px",
                          font: "inherit",
                          fontSize: "13px",
                          color: "var(--text)",
                          background: "var(--surface)",
                          outline: "none",
                          cursor: "pointer"
                        }}
                      >
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="7days">Last 7 Days</option>
                        <option value="30days">Last 30 Days</option>
                        <option value="custom">Custom Range</option>
                      </select>
                    </div>

                    {dateFilter === "custom" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={(e) => setCustomStartDate(e.target.value)}
                          style={{
                            height: "36px",
                            padding: "0 8px",
                            border: "1px solid var(--border-mid)",
                            borderRadius: "7px",
                            fontSize: "12px",
                            background: "var(--surface)"
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--text-2)" }}>to</span>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          style={{
                            height: "36px",
                            padding: "0 8px",
                            border: "1px solid var(--border-mid)",
                            borderRadius: "7px",
                            fontSize: "12px",
                            background: "var(--surface)"
                          }}
                        />
                      </div>
                    )}

                    <input
                      type="file"
                      id="csvFileInput"
                      accept=".csv"
                      multiple
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
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody id="outreachTableBody">{renderOutreachRows(getFilteredLeads())}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {sidebarTab === "Dashboard" && (
          <>
            <header className="topbar">
              <div className="topbar-inner">
                <div className="brand">
                  <div className="brand-name">Dashboard</div>
                  <div className="brand-sub">Platform metrics and integration statuses.</div>
                </div>
              </div>
            </header>

            <div className="page">
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div className="card" style={{ padding: "24px" }}>
                  <h2 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "8px", color: "var(--text)" }}>Dashboard Overview</h2>
                  <p style={{ color: "var(--text-2)", fontSize: "13.5px" }}>Manage and monitor all active lead scraping operations across your platforms.</p>
                </div>
                
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{job?.total || 0}</div>
                    <div className="stat-label">Upwork Profiles Scraped</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: "var(--text-3)" }}>0</div>
                    <div className="stat-label">Fiverr Profiles Scraped</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: "var(--text-3)" }}>0</div>
                    <div className="stat-label">Other Platform Leads</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value accent">Active</div>
                    <div className="stat-label">System Gateway Status</div>
                  </div>
                </div>

                <div className="card" style={{ padding: "24px" }}>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", marginBottom: "16px", color: "var(--text)" }}>Platform Integrations</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg)", borderRadius: "8px" }}>
                      <div style={{ fontWeight: "600", fontSize: "13px" }}>Upwork Scraper Bridge</div>
                      <span style={{ fontSize: "11px", background: "#bbf7d0", color: "#16a34a", padding: "3px 8px", borderRadius: "999px", fontWeight: "600" }}>Connected</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg)", borderRadius: "8px", opacity: 0.6 }}>
                      <div style={{ fontWeight: "600", fontSize: "13px" }}>Fiverr Scraper</div>
                      <span style={{ fontSize: "11px", background: "#e5e7eb", color: "#6b7280", padding: "3px 8px", borderRadius: "999px", fontWeight: "600" }}>Planned</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg)", borderRadius: "8px", opacity: 0.6 }}>
                      <div style={{ fontWeight: "600", fontSize: "13px" }}>LinkedIn Scraper</div>
                      <span style={{ fontSize: "11px", background: "#e5e7eb", color: "#6b7280", padding: "3px 8px", borderRadius: "999px", fontWeight: "600" }}>Planned</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {sidebarTab !== "Upwork" && sidebarTab !== "Dashboard" && (
          <>
            <header className="topbar">
              <div className="topbar-inner">
                <div className="brand">
                  <div className="brand-name">{sidebarTab} Integration</div>
                  <div className="brand-sub">Automate lead generation on {sidebarTab}.</div>
                </div>
              </div>
            </header>

            <div className="page">
              <div className="card" style={{ padding: "48px 32px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--blue-light)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "8px" }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="16"></line>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                  </svg>
                </div>
                <h2 style={{ fontSize: "18px", fontWeight: "700" }}>{sidebarTab} Scraper Integration</h2>
                <p style={{ color: "var(--text-2)", maxWidth: "460px", fontSize: "13.5px", lineHeight: "1.6" }}>
                  The lead scraper bridge for <strong>{sidebarTab}</strong> is currently in development. You will be able to automate searches and enrich profiles similarly to our Upwork bridge.
                </p>
                <button className="btn btn-primary" onClick={() => setSidebarTab("Upwork")} style={{ marginTop: "8px" }}>
                  Go back to Upwork Scraper
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
