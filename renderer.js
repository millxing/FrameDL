// State
let queue = [];
let activeDownloads = new Map();

// DOM Elements
const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");
const versionBadge = document.getElementById("version-badge");
const urlInput = document.getElementById("url-input");
const addToQueueBtn = document.getElementById("add-to-queue");
const activeDownloadsEl = document.getElementById("active-downloads");
const queueListEl = document.getElementById("queue-list");
const historyListEl = document.getElementById("history-list");
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
  processQueue();
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
addToQueueBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const format = document.querySelector(
    'input[name="format"]:checked'
  ).value;

  queue.push({
    id: Date.now().toString(),
    url,
    format,
    status: "pending",
  });

  urlInput.value = "";
  renderQueue();
  processQueue();
});

// URLs sent by the browser extension
let externalCount = 0;
window.ytdlp.onExternalDownload(({ url, format }) => {
  queue.push({
    id: `${Date.now()}-ext${externalCount++}`,
    url,
    format,
    noPlaylist: true,
    status: "pending",
  });
  renderQueue();
  processQueue();
});

function renderQueue() {
  if (queue.length === 0) {
    queueListEl.innerHTML = '<p class="empty-state">Queue is empty</p>';
    return;
  }

  queueListEl.innerHTML = queue
    .map(
      (item) => `
    <div class="queue-item" data-id="${item.id}">
      <div class="queue-item-header">
        <span class="queue-item-title">${escapeHtml(item.url)}</span>
        <span class="queue-item-format">${item.format === "mp3" ? "🎵 MP3" : "🎬 Video"}</span>
      </div>
      <div class="queue-item-actions">
        <span class="hint">${item.status}</span>
        ${item.status === "pending" ? `<button class="btn small danger remove-queue" data-id="${item.id}">Remove</button>` : ""}
      </div>
    </div>
  `
    )
    .join("");

  document.querySelectorAll(".remove-queue").forEach((btn) => {
    btn.addEventListener("click", () => {
      queue = queue.filter((item) => item.id !== btn.dataset.id);
      renderQueue();
    });
  });
}

document.getElementById("clear-queue").addEventListener("click", () => {
  queue = queue.filter((item) => item.status !== "pending");
  renderQueue();
});

// Process queue with concurrency
const MAX_CONCURRENT = 3;

async function processQueue() {
  const pending = queue.filter((item) => item.status === "pending");
  const downloading = queue.filter((item) => item.status === "downloading");

  const available = MAX_CONCURRENT - downloading.length;

  for (let i = 0; i < Math.min(available, pending.length); i++) {
    const item = pending[i];
    item.status = "downloading";
    renderQueue();
    startDownload(item);
  }
}

async function startDownload(item) {
  activeDownloads.set(item.id, {
    ...item,
    percent: 0,
    speed: "",
    eta: "",
    size: "",
  });
  renderActiveDownloads();

  const unsubscribe = window.ytdlp.onDownloadProgress(item.id, (progress) => {
    const download = activeDownloads.get(item.id);
    if (download) {
      Object.assign(download, progress);
      renderActiveDownloads();
    }
  });

  try {
    const result = await window.ytdlp.startDownload({
      id: item.id,
      url: item.url,
      format: item.format,
      noPlaylist: item.noPlaylist,
    });

    item.status = result.success ? "completed" : "failed";
  } catch (error) {
    item.status = "failed";
  }

  unsubscribe();
  activeDownloads.delete(item.id);
  queue = queue.filter((q) => q.id !== item.id);

  renderActiveDownloads();
  renderQueue();
  processQueue();
  updateDiskSpace();
}

function renderActiveDownloads() {
  if (activeDownloads.size === 0) {
    activeDownloadsEl.innerHTML =
      '<p class="empty-state">No active downloads</p>';
    return;
  }

  activeDownloadsEl.innerHTML = Array.from(activeDownloads.values())
    .map(
      (d) => `
    <div class="download-item" data-id="${d.id}">
      <div class="download-item-header">
        <span class="download-item-title">${escapeHtml(d.url)}</span>
        <span class="download-item-format">${d.format === "mp3" ? "🎵 MP3" : "🎬 Video"}</span>
      </div>
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${d.percent}%"></div>
        </div>
        <div class="progress-info">
          <span>${d.percent.toFixed(1)}% of ${d.size || "..."}</span>
          <span>${d.speed || "..."} • ETA ${d.eta || "..."}</span>
        </div>
      </div>
      <button class="btn small danger cancel-download" data-id="${d.id}" style="margin-top: 10px">Cancel</button>
    </div>
  `
    )
    .join("");

  document.querySelectorAll(".cancel-download").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await window.ytdlp.cancelDownload(btn.dataset.id);
    });
  });
}

// History
async function loadHistory() {
  const history = await window.ytdlp.getHistory();

  if (history.length === 0) {
    historyListEl.innerHTML = '<p class="empty-state">No downloads yet</p>';
    return;
  }

  historyListEl.innerHTML = history
    .map(
      (item) => `
    <div class="history-item ${item.success ? "success" : "failed"}" data-path="${escapeHtml(item.filePath || "")}">
      <div class="history-item-header">
        <span class="history-item-title">${escapeHtml(item.title || item.url)}</span>
        <span class="history-item-date">${new Date(item.date).toLocaleString()}</span>
      </div>
      <div class="hint">${item.success ? "✓ Downloaded" : "✗ Failed"} • ${item.format === "mp3" ? "MP3" : "Video"}</div>
      ${item.error ? `<div class="hint" style="color: #ff6b6b; margin-top: 4px; font-size: 0.8em; word-break: break-all;">${escapeHtml(item.error)}</div>` : ""}
    </div>
  `
    )
    .join("");

  document.querySelectorAll(".history-item.success").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const filePath = el.dataset.path;
      if (filePath) window.ytdlp.openFile(filePath);
    });
  });
}

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