// FrameDL browser extension.
// Toolbar button: send the current page URL to the FrameDL app as a video download.
// Right-click the toolbar button: download audio only (MP3).

const BRIDGE = "http://127.0.0.1:47631";
const MP3_MENU_ID = "framedl-mp3";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MP3_MENU_ID,
    title: "Download audio only (MP3)",
    contexts: ["action"],
  });
});

chrome.action.onClicked.addListener((tab) => send(tab, "video"));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MP3_MENU_ID) send(tab, "mp3");
});

async function send(tab, format) {
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return flash(tab, "!", "#c0392b", "FrameDL: this page has no web address to download");
  }

  // 1. FrameDL is running: use the local bridge. No prompt.
  try {
    const response = await fetch(`${BRIDGE}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, format }),
    });
    if (response.ok) {
      return flash(tab, "OK", "#2e7d32", "FrameDL: added to queue");
    }
    const result = await response.json().catch(() => ({}));
    return flash(tab, "!", "#c0392b", `FrameDL: ${result.error || "request rejected"}`);
  } catch {
    // FrameDL is not running. Continue to step 2.
  }

  // 2. Start FrameDL with a framedl:// link. The browser asks for approval.
  const link =
    `framedl://download?url=${encodeURIComponent(tab.url)}&format=${format}`;
  try {
    await chrome.tabs.update(tab.id, { url: link });
    flash(tab, "...", "#1565c0", "FrameDL: starting the app");
  } catch (e) {
    flash(tab, "!", "#c0392b", `FrameDL: could not start the app (${e.message})`);
  }
}

function flash(tab, text, color, title) {
  const tabId = tab && tab.id;
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
    chrome.action.setTitle({ title: "Download with FrameDL", tabId }).catch(() => {});
  }, 4000);
}
