const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const os = require("os");
const https = require("https");
const http = require("http");

// Paths
const DEFAULT_DOWNLOAD_PATH = path.join(os.homedir(), "Downloads", "yt-dlp");
// Keep data from the pre-rename app (history, settings, updated yt-dlp)
app.setPath("userData", path.join(app.getPath("appData"), "yt-dlp-manager"));
const DATA_PATH = path.join(app.getPath("userData"), "data.json");
const USER_BIN_PATH = path.join(app.getPath("userData"), "bin");

// GitHub release URL for standalone yt-dlp macOS binary
const YTDLP_RELEASE_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";

let mainWindow;

// Browser extension bridge.
// The extension sends page URLs to a local HTTP server when the app is running.
// When the app is not running, the extension opens a framedl:// link, which
// starts the app and delivers the URL through the "open-url" event.
const BRIDGE_PORT = 47631;
const URL_SCHEME = "framedl";

// Binary resolution
function getBundledBinPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin");
  }
  return path.join(__dirname, "bin");
}

function getYtDlpPath() {
  // Check for user-updated binary first, then fall back to bundled
  const userBinary = path.join(USER_BIN_PATH, "yt-dlp_macos");
  if (fs.existsSync(userBinary)) {
    return userBinary;
  }
  return path.join(getBundledBinPath(), "yt-dlp_macos");
}

function getFfmpegDir() {
  return getBundledBinPath();
}

function ensureBinDir() {
  if (!fs.existsSync(USER_BIN_PATH)) {
    fs.mkdirSync(USER_BIN_PATH, { recursive: true });
  }
}

function ensureBinaryPermissions() {
  const binaries = [
    getYtDlpPath(),
    path.join(getBundledBinPath(), "ffmpeg"),
    path.join(getBundledBinPath(), "ffprobe"),
    path.join(getBundledBinPath(), "deno"),
  ];
  for (const bin of binaries) {
    try {
      if (fs.existsSync(bin)) {
        fs.chmodSync(bin, 0o755);
        // Remove macOS quarantine attribute if present
        try {
          execSync(`xattr -d com.apple.quarantine "${bin}" 2>/dev/null`);
        } catch {
          // Ignore — attribute may not be set
        }
      }
    } catch (e) {
      console.error(`Failed to set permissions on ${bin}:`, e);
    }
  }
}

// Download helper for fetching binaries from URLs (follows redirects)
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (urlStr) => {
      https
        .get(urlStr, { headers: { "User-Agent": "FrameDL" } }, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            request(response.headers.location);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          response.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              fs.chmodSync(destPath, 0o755);
              resolve();
            });
          });
        })
        .on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
    };
    request(url);
  });
}

// Initialize data file
function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    }
  } catch (e) {
    console.error("Error loading data:", e);
  }
  return {
    settings: {
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      cookieBrowser: null,
      filenameTemplate: "%(title)s.%(ext)s",
      videoCodec: "best",
    },
    history: [],
    queue: [],
  };
}

// Video format selection. H.264 + AAC MP4s play instantly in FrameLoop and QuickTime;
// AV1/VP9 + Opus (what "best" usually picks) must be converted first.
const H264_FORMAT =
  "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*[vcodec^=avc1]+ba/bv*+ba/b";
const VIDEO_FORMATS = {
  // Best quality YouTube offers, whatever the codec (original behavior)
  best: "bestvideo+bestaudio/best",
  // H.264 whenever available (YouTube's H.264 tops out at 1080p)
  h264: H264_FORMAT,
  // Anything taller than 1080p stays best quality; 1080p and below becomes H.264
  "h264-1080": `bv*[height>1080]+ba/${H264_FORMAT}`,
};

function videoFormatFor(settings) {
  return VIDEO_FORMATS[settings.videoCodec] || VIDEO_FORMATS.best;
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

let appData = loadData();

// Ensure download directory exists
if (!fs.existsSync(appData.settings.downloadPath)) {
  fs.mkdirSync(appData.settings.downloadPath, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    title: "FrameDL",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile("index.html");
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// The window can be closed while downloads run. Send only if it exists.
function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Add a URL from the browser extension to the download queue.
// Returns an error string, or null on success.
function queueExternal(rawUrl, rawFormat) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs are supported";
  }

  // On a "video in a playlist" URL, the extension downloads only the video.
  addToQueue({ url: parsed.href, format: rawFormat, noPlaylist: true });
  return null;
}

// framedl://download?url=<encoded page URL>&format=video|mp3
app.on("open-url", (event, link) => {
  event.preventDefault();
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== `${URL_SCHEME}:`) return;
    const error = queueExternal(
      parsed.searchParams.get("url"),
      parsed.searchParams.get("format")
    );
    if (error) console.error("Rejected link:", error);
  } catch (e) {
    console.error("Bad link:", e);
  }
});

function startBridgeServer() {
  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // Web pages can also send requests to localhost. Browsers always set the
    // Origin header and pages cannot change it, so accept extensions only.
    const origin = req.headers.origin || "";
    if (!origin.startsWith("chrome-extension://")) {
      return reply(403, { ok: false, error: "Forbidden" });
    }

    if (req.method === "GET" && req.url === "/ping") {
      return reply(200, { ok: true, app: "FrameDL", version: app.getVersion() });
    }

    if (req.method === "POST" && req.url === "/download") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16384) req.destroy();
      });
      req.on("end", () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          return reply(400, { ok: false, error: "Invalid JSON" });
        }
        const error = queueExternal(payload.url, payload.format);
        if (error) return reply(400, { ok: false, error });
        reply(200, { ok: true });
      });
      return;
    }

    reply(404, { ok: false, error: "Not found" });
  });

  server.on("error", (e) => {
    // The framedl:// link still works without the server.
    console.error("Bridge server error:", e.message);
  });
  server.listen(BRIDGE_PORT, "127.0.0.1");
}

app.whenReady().then(() => {
  ensureBinaryPermissions();
  createWindow();
  startBridgeServer();
  // Start items that stayed in the queue from the last session.
  processQueue();
});

// Stop yt-dlp when the app quits. The items stay in the saved queue and
// start again at the next launch.
app.on("before-quit", () => {
  quitting = true;
  for (const proc of activeProcs.values()) {
    proc.kill("SIGTERM");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Helper to run commands
function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Exit code ${code}`));
    });
  });
}

// IPC Handlers

ipcMain.handle("update-dependencies", async () => {
  return {
    success: true,
    output: "All dependencies are bundled with the app. No updates needed.",
  };
});

ipcMain.handle("install-ytdlp", async () => {
  try {
    ensureBinDir();
    const destPath = path.join(USER_BIN_PATH, "yt-dlp_macos");
    await downloadFile(YTDLP_RELEASE_URL, destPath);
    const version = await runCommand(`"${destPath}" --version`);
    return { success: true, version };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("update-ytdlp", async () => {
  try {
    ensureBinDir();
    const destPath = path.join(USER_BIN_PATH, "yt-dlp_macos");
    await downloadFile(YTDLP_RELEASE_URL, destPath);
    const version = await runCommand(`"${destPath}" --version`);
    return { success: true, version };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-version", async () => {
  try {
    const ytdlp = getYtDlpPath();
    const version = await runCommand(`"${ytdlp}" --version`);
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
});

ipcMain.handle("set-cookie-browser", (_, browser) => {
  appData.settings.cookieBrowser = browser;
  saveData(appData);
  return { success: true };
});

ipcMain.handle("get-settings", () => {
  return { videoCodec: "best", ...appData.settings };
});

ipcMain.handle("set-video-codec", (_, codec) => {
  if (!VIDEO_FORMATS[codec]) return { success: false };
  appData.settings.videoCodec = codec;
  saveData(appData);
  return { success: true };
});

ipcMain.handle("select-download-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: appData.settings.downloadPath,
  });
  if (!result.canceled && result.filePaths.length > 0) {
    appData.settings.downloadPath = result.filePaths[0];
    saveData(appData);
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle("set-filename-template", (_, template) => {
  appData.settings.filenameTemplate = template;
  saveData(appData);
  return { success: true };
});

ipcMain.handle("get-disk-space", async () => {
  try {
    const downloadPath = appData.settings.downloadPath;
    const stats = await runCommand(`df -h "${downloadPath}" | tail -1`);
    const parts = stats.split(/\s+/);
    return { available: parts[3], used: parts[2], capacity: parts[4] };
  } catch {
    return { available: "Unknown", used: "Unknown", capacity: "Unknown" };
  }
});

ipcMain.handle("get-history", () => {
  return appData.history;
});

ipcMain.handle("clear-history", () => {
  appData.history = [];
  saveData(appData);
  return { success: true };
});

ipcMain.handle("open-download-folder", () => {
  shell.openPath(appData.settings.downloadPath);
});

ipcMain.handle("open-file", (_, filePath) => {
  shell.openPath(filePath);
});

// Download queue.
// The main process owns the queue. Thus downloads continue when the window is
// closed, and items that are not complete stay in the queue after a restart.
const MAX_CONCURRENT = 3;
const activeProcs = new Map(); // item id -> yt-dlp process
let quitting = false;
let idCounter = 0;

// Items from the last session start again. yt-dlp continues partial files.
let queue = (Array.isArray(appData.queue) ? appData.queue : [])
  .filter((item) => item && item.id && typeof item.url === "string")
  .map((item) => ({
    id: String(item.id),
    url: item.url,
    format: item.format === "mp3" ? "mp3" : "video",
    noPlaylist: !!item.noPlaylist,
    status: "pending",
  }));

// The queue data that the window shows
function publicQueue() {
  return queue.map(({ id, url, format, status, percent, size, speed, eta }) => ({
    id,
    url,
    format,
    status,
    percent: percent || 0,
    size: size || "",
    speed: speed || "",
    eta: eta || "",
  }));
}

function queueChanged() {
  appData.queue = queue.map(({ id, url, format, noPlaylist }) => ({
    id,
    url,
    format,
    noPlaylist,
  }));
  saveData(appData);
  sendToWindow("queue-changed", publicQueue());
}

function addToQueue({ url, format, noPlaylist }) {
  queue.push({
    id: `${Date.now()}-${idCounter++}`,
    url,
    format: format === "mp3" ? "mp3" : "video",
    noPlaylist: !!noPlaylist,
    status: "pending",
  });
  queueChanged();
  processQueue();
}

function processQueue() {
  if (quitting) return;
  let running = queue.filter((item) => item.status === "downloading").length;
  let started = false;
  for (const item of queue) {
    if (running >= MAX_CONCURRENT) break;
    if (item.status !== "pending") continue;
    item.status = "downloading";
    running++;
    started = true;
    runDownload(item);
  }
  if (started) queueChanged();
}

// Keep a reference to each notification until it closes. If not, the click
// handler can be lost.
const liveNotifications = new Set();

function notify(title, body, onClick) {
  if (!app.isReady() || !Notification.isSupported()) return;
  // The window already shows the result when it is in front.
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;

  const notification = new Notification({ title, body });
  liveNotifications.add(notification);
  notification.on("click", () => {
    liveNotifications.delete(notification);
    onClick();
  });
  notification.on("close", () => liveNotifications.delete(notification));
  notification.show();
}

function runDownload(item) {
  const { id, url, format } = item;
  const ffmpegDir = getFfmpegDir();
  const outputTemplate = path.join(
    appData.settings.downloadPath,
    appData.settings.filenameTemplate
  );

  const args = [
    url,
    "-o",
    outputTemplate,
    "--newline",
    // --print makes yt-dlp quiet. --progress keeps the progress lines.
    "--progress",
    "--no-simulate",
    "--print",
    "after_move:filepath=%(filepath)s",
    "--ffmpeg-location",
    ffmpegDir,
  ];

  if (format === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    args.push("-f", videoFormatFor(appData.settings), "--merge-output-format", "mp4");
  }

  if (appData.settings.cookieBrowser) {
    args.push("--cookies-from-browser", appData.settings.cookieBrowser);
  }

  // On a "video in a playlist" URL, download only the video.
  // A URL for a playlist page still downloads the full playlist.
  if (item.noPlaylist) {
    args.push("--no-playlist");
  }

  // Add bundled bin dir to PATH so yt-dlp can find deno and ffmpeg
  const env = { ...process.env };
  env.PATH = getBundledBinPath() + ":" + (env.PATH || "");

  const proc = spawn(getYtDlpPath(), args, { env });
  activeProcs.set(id, proc);

  let title = url;
  let filePath = "";
  let lastError = "";
  const errorLines = [];

  proc.stdout.on("data", (data) => {
    const text = data.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;

      // Final post-processing path (set after merge/audio extraction)
      const finalPath = line.match(/^filepath=(.+)$/);
      if (finalPath) {
        filePath = finalPath[1];
        title = path.basename(filePath);
        continue;
      }

      // Initial destination
      const destMatch = line.match(/^\[download\] Destination: (.+)$/);
      if (destMatch) {
        if (!filePath) filePath = destMatch[1];
        title = path.basename(destMatch[1]);
      }

      // File already exists at output path
      const alreadyMatch = line.match(/^\[download\] (.+) has already been downloaded$/);
      if (alreadyMatch) {
        filePath = alreadyMatch[1];
        title = path.basename(filePath);
      }

      // Merger output (final muxed file)
      const mergerMatch = line.match(/^\[Merger\] Merging formats into "(.+)"$/);
      if (mergerMatch) {
        filePath = mergerMatch[1];
        title = path.basename(filePath);
      }

      // Progress — parse percent first, then size/speed/eta if present
      const percentMatch = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (percentMatch) {
        const sizeMatch = line.match(/of\s+~?\s*(\S+)/);
        const speedMatch = line.match(/at\s+(\S+(?:\s+\S+)?\/s|\S+\s+B\/s)/);
        const etaMatch = line.match(/ETA\s+(\S+)/);
        item.percent = parseFloat(percentMatch[1]);
        item.size = sizeMatch ? sizeMatch[1] : "";
        item.speed = speedMatch ? speedMatch[1].replace(/\s+/g, " ") : "";
        item.eta = etaMatch ? etaMatch[1] : "";
        sendToWindow("download-progress", {
          id,
          percent: item.percent,
          size: item.size,
          speed: item.speed,
          eta: item.eta,
        });
      }
    }
  });

  proc.stderr.on("data", (data) => {
    const msg = data.toString();
    console.error("yt-dlp stderr:", msg);
    for (const line of msg.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      errorLines.push(trimmed);
      if (/^ERROR:/i.test(trimmed) || /^WARNING:/i.test(trimmed)) {
        lastError = trimmed;
      }
    }
  });

  let finished = false;
  const finish = (code, spawnError) => {
    if (finished) return;
    finished = true;
    activeProcs.delete(id);

    // The app stopped this download because it quits. Keep the item in the
    // saved queue.
    if (quitting) return;

    queue = queue.filter((q) => q !== item);

    const fileExists = !!filePath && fs.existsSync(filePath);
    const success = code === 0 && fileExists;
    let error;

    if (!success) {
      if (item.cancelled) {
        error = "Cancelled";
      } else if (spawnError) {
        error = `Could not start yt-dlp: ${spawnError.message}`;
      } else if (code !== 0) {
        error = lastError || errorLines.slice(-3).join(" | ") || `yt-dlp exited with code ${code}`;
      } else if (!filePath) {
        error = "yt-dlp reported success but produced no output file. " +
          (errorLines.length ? `Messages: ${errorLines.slice(-3).join(" | ")}` : "Check yt-dlp logs.");
      } else {
        error = `Expected file not found: ${filePath}`;
      }
    }

    const savedPath = fileExists ? filePath : "";
    appData.history.unshift({
      id,
      url,
      title,
      filePath: savedPath,
      format,
      date: new Date().toISOString(),
      success,
      error,
    });
    if (appData.history.length > 100) appData.history.pop();
    queueChanged(); // also saves the history

    if (success) {
      notify("Download complete", title, () => shell.showItemInFolder(savedPath));
    } else if (!item.cancelled) {
      notify("Download failed", `${title}\n${error}`, showWindow);
    }

    processQueue();
  };

  proc.on("error", (e) => finish(null, e));
  proc.on("close", (code) => finish(code));
}

ipcMain.handle("queue-get", () => publicQueue());

ipcMain.handle("queue-add", (_, { url, format }) => {
  const trimmed = String(url || "").trim();
  // Text that starts with "-" would be read by yt-dlp as an option.
  if (!trimmed || trimmed.startsWith("-")) return { success: false };
  addToQueue({ url: trimmed, format });
  return { success: true };
});

ipcMain.handle("queue-remove", (_, id) => {
  queue = queue.filter((item) => !(item.id === id && item.status === "pending"));
  queueChanged();
  return { success: true };
});

ipcMain.handle("queue-clear", () => {
  queue = queue.filter((item) => item.status !== "pending");
  queueChanged();
  return { success: true };
});

ipcMain.handle("cancel-download", (_, id) => {
  const item = queue.find((q) => q.id === id);
  const proc = activeProcs.get(id);
  if (!item || !proc) return { success: false };
  item.cancelled = true;
  proc.kill("SIGTERM");
  return { success: true };
});
