// FrameDL browser extension.
// Toolbar button: send the current page URL to the FrameDL app as a video download.
// Right-click the toolbar button: download audio only (MP3).

// "localhost" is common to all user accounts on the Mac. Each account that
// runs FrameDL has one of these ports. The token makes sure that the request
// goes to the app of this account: an app accepts a token only after it got
// that token in a framedl:// link, and macOS delivers a link only to the app
// of the account that clicked it.
const PORTS = [47631, 47632, 47633, 47634, 47635];
const MP3_MENU_ID = "framedl-mp3";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MP3_MENU_ID,
      title: "Download audio only (MP3)",
      contexts: ["action"],
    });
  });
});

chrome.action.onClicked.addListener((tab) => send(tab, "video"));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MP3_MENU_ID) send(tab, "mp3");
});

async function getToken() {
  const stored = await chrome.storage.local.get("token");
  if (stored.token) return stored.token;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ token });
  return token;
}

async function send(tab, format) {
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return flash(tab, "!", "#c0392b", "FrameDL: this page has no web address to download");
  }

  const token = await getToken();

  // 1. FrameDL is running in this account: use the local server. No prompt.
  for (const port of PORTS) {
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: tab.url, format, token, title: tab.title || "" }),
      });
    } catch {
      continue; // Nothing listens on this port.
    }
    if (response.ok) {
      return flash(tab, "OK", "#2e7d32", "FrameDL: added to queue");
    }
    if (response.status === 403) {
      continue; // The app of a different account, or an app that does not know the token yet.
    }
    const result = await response.json().catch(() => ({}));
    return flash(tab, "!", "#c0392b", `FrameDL: ${result.error || "request rejected"}`);
  }

  // 2. Use a framedl:// link. macOS opens FrameDL in this account, the app
  //    adds the download and learns the token. The browser asks for approval.
  const link =
    `framedl://download?url=${encodeURIComponent(tab.url)}` +
    `&format=${format}&token=${token}` +
    `&title=${encodeURIComponent((tab.title || "").slice(0, 200))}`;
  try {
    await chrome.tabs.update(tab.id, { url: link });
    flash(tab, "...", "#1565c0", "FrameDL: opening the app");
  } catch (e) {
    flash(tab, "!", "#c0392b", `FrameDL: could not open the app (${e.message})`);
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
