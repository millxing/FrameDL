// State. The main process owns the queue. This is a copy for display.
let queue = [];

// DOM Elements
const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");
const versionBadge = document.getElementById("version-badge");
const urlInput = document.getElementById("url-input");
const addToQueueBtn = document.getElementById("add-to-queue");
const activeDownloadsEl = document.getElementById("active-downloads");
const queueListEl = document.getElementById("queue-list");
const historyListEl = document.getElementById("history-list");
const recentListEl = document.getElementById("recent-list");
const diskSpaceEl = document.getElementById("disk-space");
const downloadPathEl = document.getElementById("download-path");
const filenameTemplateEl = document.getElementById("filename-template");
const installStatusEl = document.getElementById("install-status");

// Tab switching
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");

    if (tab.dataset.tab === "history") loadHistory();
  });
});

// Initialize
async function init() {
  await checkVersion();
  await loadSettings();
  await updateDiskSpace();
  await loadHistory();
  queue = await window.ytdlp.getQueue();
  renderAll();
}

async function checkVersion() {
  const result = await window.ytdlp.getVersion();
  if (result.installed) {
    versionBadge.textContent = `v${result.version}`;
    versionBadge.classList.add("installed");
    versionBadge.classList.remove("not-installed");
  } else {
    versionBadge.textContent = "Not installed";
    versionBadge.classList.add("not-installed");
    versionBadge.classList.remove("installed");
  }
}

async function loadSettings() {
  const settings = await window.ytdlp.getSettings();
  downloadPathEl.textContent = settings.downloadPath;
  filenameTemplateEl.value = settings.filenameTemplate;

  const codecRadio = document.querySelector(
    `input[name="video-codec"][value="${settings.videoCodec}"]`
  );
  if (codecRadio) codecRadio.checked = true;

  if (settings.cookieBrowser) {
    const radio = document.querySelector(
      `input[name="cookie-browser"][value="${settings.cookieBrowser}"]`
    );
    if (radio) radio.checked = true;
  } else {
    document.querySelector(
      'input[name="cookie-browser"][value=""]'
    ).checked = true;
  }
}

async function updateDiskSpace() {
  const space = await window.ytdlp.getDiskSpace();
  diskSpaceEl.textContent = `💾 ${space.available} available`;
}

// Queue management
addToQueueBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const format = document.querySelector(
    'input[name="format"]:checked'
  ).value;

  const result = await window.ytdlp.addToQueue({ url, format });
  if (result.success) urlInput.value = "";
});

// The main process sends the full queue when an item is added, starts,
// completes or is removed.
window.ytdlp.onQueueChanged((items) => {
  queue = items;
  renderAll();
  loadHistory();
  updateDiskSpace();
});

// Progress changes only one item. Update that item and do not build the
// lists again.
window.ytdlp.onDownloadProgress((progress) => {
  const item = queue.find((q) => q.id === progress.id);
  if (!item) return;
  Object.assign(item, progress);

  const el = activeDownloadsEl.querySelector(
    `.download-item[data-id="${CSS.escape(item.id)}"]`
  );
  if (!el) return;
  el.querySelector(".progress-fill").style.width = `${item.percent}%`;
  el.querySelector(".progress-amount").textContent = amountText(item);
  el.querySelector(".progress-rate").textContent = rateText(item);
});

function renderAll() {
  renderQueue();
  renderActiveDownloads();
}

function formatLabel(format) {
  return format === "mp3" ? "🎵 MP3" : "🎬 Video";
}

function amountText(d) {
  return `${d.percent.toFixed(1)}% of ${d.size || "..."}`;
}

function rateText(d) {
  return `${d.speed || "..."} • ETA ${d.eta || "..."}`;
}

function renderQueue() {
  if (queue.length === 0) {
    queueListEl.innerHTML = '<p class="empty-state">Queue is empty</p>';
    return;
  }

  queueListEl.innerHTML = queue
    .map(
      (item) => `
    <div class="queue-item" data-id="${escapeHtml(item.id)}">
      <div class="queue-item-header">
        <span class="queue-item-title">${escapeHtml(item.url)}</span>
        <span class="queue-item-format">${formatLabel(item.format)}</span>
      </div>
      <div class="queue-item-actions">
        <span class="hint">${item.status}</span>
        ${item.status === "pending" ? `<button class="btn small danger remove-queue" data-id="${escapeHtml(item.id)}">Remove</button>` : ""}
      </div>
    </div>
  `
    )
    .join("");
}

queueListEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-queue");
  if (btn) window.ytdlp.removeFromQueue(btn.dataset.id);
});

document.getElementById("clear-queue").addEventListener("click", () => {
  window.ytdlp.clearQueue();
});

function renderActiveDownloads() {
  const active = queue.filter((item) => item.status === "downloading");
  if (active.length === 0) {
    activeDownloadsEl.innerHTML =
      '<p class="empty-state">No active downloads</p>';
    return;
  }

  activeDownloadsEl.innerHTML = active
    .map(
      (d) => `
    <div class="download-item" data-id="${escapeHtml(d.id)}">
      <div class="download-item-header">
        <span class="download-item-title">${escapeHtml(d.url)}</span>
        <span class="download-item-format">${formatLabel(d.format)}</span>
      </div>
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${d.percent}%"></div>
        </div>
        <div class="progress-info">
          <span class="progress-amount">${escapeHtml(amountText(d))}</span>
          <span class="progress-rate">${escapeHtml(rateText(d))}</span>
        </div>
      </div>
      <button class="btn small danger cancel-download" data-id="${escapeHtml(d.id)}" style="margin-top: 10px">Cancel</button>
    </div>
  `
    )
    .join("");
}

activeDownloadsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".cancel-download");
  if (btn) window.ytdlp.cancelDownload(btn.dataset.id);
});

// History
function historyItemHtml(item) {
  return `
    <div class="history-item ${item.success ? "success" : "failed"}" data-path="${escapeHtml(item.filePath || "")}">
      <div class="history-item-header">
        <span class="history-item-title">${escapeHtml(item.title || item.url)}</span>
        <span class="history-item-date">${new Date(item.date).toLocaleString()}</span>
      </div>
      <div class="hint">${item.success ? "✓ Downloaded" : "✗ Failed"} • ${item.format === "mp3" ? "MP3" : "Video"}</div>
      ${item.error ? `<div class="hint" style="color: #ff6b6b; margin-top: 4px; font-size: 0.8em; word-break: break-all;">${escapeHtml(item.error)}</div>` : ""}
    </div>
  `;
}

// Results on the Download tab: items completed after this time.
// It starts as the time the app started. "Clear" moves it to now.
let recentSince = null;

async function loadHistory() {
  const history = await window.ytdlp.getHistory();

  historyListEl.innerHTML =
    history.length === 0
      ? '<p class="empty-state">No downloads yet</p>'
      : history.map(historyItemHtml).join("");

  if (!recentSince) recentSince = await window.ytdlp.getSessionStart();
  const recent = history.filter((item) => item.date > recentSince).slice(0, 10);
  recentListEl.innerHTML =
    recent.length === 0
      ? '<p class="empty-state">No downloads completed since the app started</p>'
      : recent.map(historyItemHtml).join("");
}

// Click a successful item to open the file
function openHistoryItem(e) {
  const el = e.target.closest(".history-item.success");
  if (el && el.dataset.path) window.ytdlp.openFile(el.dataset.path);
}
historyListEl.addEventListener("click", openHistoryItem);
recentListEl.addEventListener("click", openHistoryItem);

document.getElementById("clear-recent").addEventListener("click", () => {
  recentSince = new Date().toISOString();
  loadHistory();
});

document.getElementById("clear-history").addEventListener("click", async () => {
  await window.ytdlp.clearHistory();
  loadHistory();
});

document.getElementById("open-folder").addEventListener("click", () => {
  window.ytdlp.openDownloadFolder();
});

// Settings handlers
document.getElementById("fresh-install").addEventListener("click", async () => {
  installStatusEl.textContent = "Downloading latest yt-dlp binary...";
  installStatusEl.className = "status-message";

  const result = await window.ytdlp.install();

  if (result.success) {
    installStatusEl.textContent = `Successfully installed yt-dlp v${result.version}`;
    installStatusEl.className = "status-message success";
    checkVersion();
  } else {
    installStatusEl.textContent = `Error: ${result.error}`;
    installStatusEl.className = "status-message error";
  }
});

document.getElementById("update-ytdlp").addEventListener("click", async () => {
  installStatusEl.textContent = "Downloading latest yt-dlp binary...";
  installStatusEl.className = "status-message";

  const result = await window.ytdlp.update();

  if (result.success) {
    installStatusEl.textContent = `Successfully updated to v${result.version}`;
    installStatusEl.className = "status-message success";
    checkVersion();
  } else {
    installStatusEl.textContent = `Error: ${result.error}`;
    installStatusEl.className = "status-message error";
  }
});

document.querySelectorAll('input[name="cookie-browser"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    window.ytdlp.setCookieBrowser(e.target.value || null);
  });
});

document.querySelectorAll('input[name="video-codec"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    window.ytdlp.setVideoCodec(e.target.value);
  });
});

document.getElementById("change-path").addEventListener("click", async () => {
  const result = await window.ytdlp.selectDownloadFolder();
  if (result.success) {
    downloadPathEl.textContent = result.path;
    updateDiskSpace();
  }
});

document.getElementById("save-template").addEventListener("click", async () => {
  const template = filenameTemplateEl.value.trim();
  if (template) {
    await window.ytdlp.setFilenameTemplate(template);
  }
});

// Utility
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Start
init();