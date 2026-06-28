// Chrome DevTools Protocol helper.
// Used on Windows/Linux when Chrome is already running with remote debugging.
// On macOS the AppleScript path in chrome.js is used instead — it opens
// a new tab in the user's existing Chrome without any flags.

const CDP_HOST = process.env.CHROME_DEBUG_HOST || "127.0.0.1";
const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;

let messageId = 0;

async function isAvailable() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function listTabs() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  if (!res.ok) throw new Error("Chrome DevTools not available.");
  return res.json();
}

async function openNewTab(url) {
  const dashboardTab = await findDashboardTab().catch(() => null);
  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`CDP open tab failed: HTTP ${res.status}`);
  const tab = await res.json();
  if (dashboardTab?.id) await focusTab(dashboardTab.id).catch(() => {});
  return tab.id;
}

async function closeTab(tabId) {
  if (!tabId) return;
  await fetch(`${CDP_BASE}/json/close/${encodeURIComponent(tabId)}`).catch(
    () => {},
  );
}

async function focusTab(tabId) {
  if (!tabId) return;
  await fetch(`${CDP_BASE}/json/activate/${encodeURIComponent(tabId)}`).catch(
    () => {},
  );
}

async function findDashboardTab() {
  const tabs = await listTabs();
  return (
    tabs.find(
      (t) =>
        t.type === "page" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(t.url),
    ) || null
  );
}

async function findUpworkTab() {
  const tabs = await listTabs();
  return (
    tabs.find(
      (t) =>
        t.type === "page" &&
        t.url &&
        t.url.includes("upwork.com/nx/search/talent"),
    ) ||
    tabs.find(
      (t) => t.type === "page" && t.url && t.url.includes("upwork.com"),
    ) ||
    null
  );
}

async function getTab(tabId) {
  const tabs = await listTabs();
  return tabs.find((t) => t.id === tabId) || null;
}

async function resolveTab(tabId) {
  let tab = tabId ? await getTab(tabId) : null;
  if (!tab) tab = await findUpworkTab();
  if (!tab)
    throw new Error("No open Upwork tab found. Click Search & Start again.");
  if (!tab.webSocketDebuggerUrl)
    throw new Error("Chrome DevTools tab missing WebSocket URL.");
  return tab;
}

async function executeJavaScript(tabId, javascript, timeoutMs = 30000) {
  const tab = await resolveTab(tabId);
  const client = await connect(tab.webSocketDebuggerUrl, timeoutMs);
  try {
    await client.send("Runtime.enable");
    const result = await client.send("Runtime.evaluate", {
      expression: javascript,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      const msg =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "JS execution failed.";
      throw new Error(msg);
    }
    return result.result?.value === undefined
      ? ""
      : String(result.result.value);
  } finally {
    client.close();
  }
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

function connect(wsUrl, timeoutMs) {
  if (typeof WebSocket === "undefined") {
    throw new Error(
      "Node.js 22+ required for built-in WebSocket (CDP). Please upgrade Node.js.",
    );
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const callbacks = new Map();
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {}
      reject(new Error("Timed out connecting to Chrome DevTools."));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          const id = ++messageId;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            callbacks.set(id, { res, rej });
            setTimeout(() => {
              if (!callbacks.has(id)) return;
              callbacks.delete(id);
              rej(new Error(`CDP command timed out: ${method}`));
            }, timeoutMs);
          });
        },
        close() {
          try {
            ws.close();
          } catch (_) {}
        },
      });
    });

    ws.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!payload.id || !callbacks.has(payload.id)) return;
      const cb = callbacks.get(payload.id);
      callbacks.delete(payload.id);
      if (payload.error)
        cb.rej(new Error(payload.error.message || "CDP command failed."));
      else cb.res(payload.result || {});
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to Chrome DevTools."));
    });
  });
}

module.exports = {
  isAvailable,
  openNewTab,
  executeJavaScript,
  executeJson,
  focusTab,
  closeTab,
};
