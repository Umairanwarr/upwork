// Cross-platform Chrome controller.
//
// macOS  → AppleScript: opens a new TAB in the user's existing Chrome.
//          No Chrome flags or setup needed.
//
// Windows/Linux → Chrome DevTools Protocol (CDP).
//          Chrome must be running with:
//          --remote-debugging-port=9222 --remote-allow-origins=*
//          The dashboard shows a clear message if CDP is not reachable.
//
// Nothing is ever auto-launched. Chrome is controlled, not spawned.

const { execFile } = require("child_process");
const cdp = require("./chrome-cdp");

// ── AppleScript helpers (macOS only) ─────────────────────────────────

function appleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function runAppleScript(script, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          const raw = (stderr && stderr.trim()) || error.message;
          reject(new Error(normalizeAppleScriptError(raw)));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function normalizeAppleScriptError(msg) {
  if (
    /not allowed|JavaScript from Apple Events|execute javascript/i.test(msg)
  ) {
    return "Chrome blocked AppleScript. Go to Chrome menu → View → Developer → Allow JavaScript from Apple Events, then try again.";
  }
  if (/Application isn.t running|Can.t get application/i.test(msg)) {
    return "Google Chrome is not open. Please open Chrome first, then try again.";
  }
  if (/No open Upwork tab/i.test(msg)) {
    return "No open Upwork tab found. Keep the Upwork tab open or click Search & Start again.";
  }
  const match = msg.match(/execution error: ([\s\S]*?)(?: \(-?\d+\))?$/i);
  if (match) return match[1].trim();
  return msg || "Chrome automation failed.";
}

// ── Platform decision ─────────────────────────────────────────────────

const isMac = process.platform === "darwin";

async function preferCdp() {
  if (!isMac) return true; // Windows/Linux: always use CDP
  return cdp.isAvailable(); // macOS: use CDP only if already running
}

function windowsSetupError() {
  return new Error(
    "To use the dashboard on Windows:\n" +
      "1. Close all Chrome windows.\n" +
      "2. Open Run (Win + R) and paste:\n" +
      '   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=*\n' +
      "3. Restart the dashboard, then open the dashboard URL in Chrome.",
  );
}

// ── openNewTab ────────────────────────────────────────────────────────

async function openNewTab(url) {
  if (await preferCdp()) {
    if (!(await cdp.isAvailable())) throw windowsSetupError();
    return cdp.openNewTab(url);
  }

  // macOS AppleScript — opens a new tab in the user's existing Chrome
  // and keeps focus on the current (dashboard) tab
  const script = `
    tell application "Google Chrome"
      if (count of windows) = 0 then
        activate
        make new window
      end if

      set targetWindow to front window
      set prevIndex to active tab index of targetWindow
      set newTab to make new tab at end of tabs of targetWindow with properties {URL:${appleScriptString(url)}}
      set active tab index of targetWindow to prevIndex
      return id of newTab
    end tell
  `;

  const tabId = await runAppleScript(script);
  return Number(tabId);
}

// ── executeJavaScript / executeJson ───────────────────────────────────

async function executeJavaScript(tabId, javascript, timeoutMs = 30000) {
  if (await preferCdp()) {
    if (!(await cdp.isAvailable())) throw windowsSetupError();
    return cdp.executeJavaScript(tabId, javascript, timeoutMs);
  }

  const js = appleScriptString(javascript);
  const tid = Number(tabId);

  const script = `
    tell application "Google Chrome"
      repeat with w in windows
        repeat with t in tabs of w
          if id of t is ${tid} then
            return execute t javascript ${js}
          end if
        end repeat
      end repeat

      repeat with w in windows
        repeat with t in tabs of w
          try
            set u to URL of t
          on error
            set u to ""
          end try
          if u contains "upwork.com/nx/search/talent" then
            return execute t javascript ${js}
          end if
        end repeat
      end repeat

      repeat with w in windows
        repeat with t in tabs of w
          try
            set u to URL of t
          on error
            set u to ""
          end try
          if u contains "upwork.com" then
            return execute t javascript ${js}
          end if
        end repeat
      end repeat

      error "No open Upwork tab found. Click Search & Start again."
    end tell
  `;

  return runAppleScript(script, timeoutMs);
}

async function executeJson(tabId, javascript, timeoutMs = 30000) {
  const wrapped = `JSON.stringify((() => { ${javascript} })())`;
  const raw = await executeJavaScript(tabId, wrapped, timeoutMs);
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    throw new Error(`Could not parse Chrome response: ${e.message}`);
  }
}

// ── focusUpworkTab ────────────────────────────────────────────────────

async function focusUpworkTab(tabId) {
  if (await preferCdp()) {
    if (!(await cdp.isAvailable())) return;
    return cdp.focusTab(tabId);
  }

  const tid = Number(tabId || 0);
  const script = `
    tell application "Google Chrome"
      activate
      repeat with w in windows
        set idx to 0
        repeat with t in tabs of w
          set idx to idx + 1
          if id of t is ${tid} then
            set active tab index of w to idx
            set index of w to 1
            return "focused"
          end if
        end repeat
      end repeat
      repeat with w in windows
        set idx to 0
        repeat with t in tabs of w
          set idx to idx + 1
          try
            set u to URL of t
          on error
            set u to ""
          end try
          if u contains "upwork.com" then
            set active tab index of w to idx
            set index of w to 1
            return "focused"
          end if
        end repeat
      end repeat
    end tell
  `;

  await runAppleScript(script).catch(() => {});
  return true;
}

// ── closeUpworkTab ────────────────────────────────────────────────────

async function closeUpworkTab(tabId) {
  if (await preferCdp()) {
    if (!(await cdp.isAvailable())) return;
    return cdp.closeTab(tabId);
  }

  const tid = Number(tabId || 0);
  const script = `
    tell application "Google Chrome"
      repeat with w in windows
        repeat with t in tabs of w
          if id of t is ${tid} then
            close t
            return "closed"
          end if
        end repeat
      end repeat
      repeat with w in windows
        repeat with t in tabs of w
          try
            set u to URL of t
          on error
            set u to ""
          end try
          if u contains "upwork.com/nx/search/talent" then
            close t
            return "closed"
          end if
        end repeat
      end repeat
      return "not-found"
    end tell
  `;

  await runAppleScript(script).catch(() => {});
  return true;
}

module.exports = {
  openNewTab,
  executeJavaScript,
  executeJson,
  focusUpworkTab,
  closeUpworkTab,
};
