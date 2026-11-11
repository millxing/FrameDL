const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
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
const pendingExternal = [];
let rendererReady = false;

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

  mainWindow.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });
  mainWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;
    flushExternal();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  mainWindow.loadFile("index.html");
}

function flushExternal() {
  if (!mainWindow || !rendererReady) return;
  while (pendingExternal.length > 0) {
    mainWindow.webContents.send("external-download", pendingExternal.shift());
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

  pendingExternal.push({
    url: parsed.href,
    format: rawFormat === "mp3" ? "mp3" : "video",
  });

  if (app.isReady()) {
    if (!mainWindow) createWindow();
    else flushExternal();
  }
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

// Active downloads tracking
const activeDownloads = new Map();

ipcMain.handle(
  "start-download",
  async (_, { id, url, format, playlistIndex, noPlaylist }) => {
    const ytdlp = getYtDlpPath();
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
    if (noPlaylist) {
      args.push("--no-playlist");
    }

    if (playlistIndex !== undefined) {
      args.push("--playlist-items", String(playlistIndex));
    }

    // Add bundled bin dir to PATH so yt-dlp can find deno and ffmpeg
    const env = { ...process.env };
    env.PATH = getBundledBinPath() + ":" + (env.PATH || "");

    const proc = spawn(ytdlp, args, { env });
    activeDownloads.set(id, proc);

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
          const percent = parseFloat(percentMatch[1]);
          const sizeMatch = line.match(/of\s+~?\s*(\S+)/);
          const speedMatch = line.match(/at\s+(\S+(?:\s+\S+)?\/s|\S+\s+B\/s)/);
          const etaMatch = line.match(/ETA\s+(\S+)/);
          mainWindow.webContents.send(`download-progress-${id}`, {
            percent,
            size: sizeMatch ? sizeMatch[1] : "",
            speed: speedMatch ? speedMatch[1].replace(/\s+/g, " ") : "",
            eta: etaMatch ? etaMatch[1] : "",
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
      mainWindow.webContents.send(`download-progress-${id}`, {
        error: msg,
      });
    });

    return new Promise((resolve) => {
      proc.on("close", (code) => {
        activeDownloads.delete(id);

        const fileExists = !!filePath && fs.existsSync(filePath);
        let success = code === 0 && fileExists;
        let error;

        if (!success) {
          if (code !== 0) {
            error = lastError || errorLines.slice(-3).join(" | ") || `yt-dlp exited with code ${code}`;
          } else if (!filePath) {
            error = "yt-dlp reported success but produced no output file. " +
              (errorLines.length ? `Messages: ${errorLines.slice(-3).join(" | ")}` : "Check yt-dlp logs.");
          } else {
            error = `Expected file not found: ${filePath}`;
          }
        }

        const historyEntry = {
          id,
          url,
          title,
          filePath: fileExists ? filePath : "",
          format,
          date: new Date().toISOString(),
          success,
          error,
        };

        appData.history.unshift(historyEntry);
        if (appData.history.length > 100) appData.history.pop();
        saveData(appData);

        resolve({ success, title, filePath: historyEntry.filePath, error });
      });
    });
  }
);

ipcMain.handle("cancel-download", (_, id) => {
  const proc = activeDownloads.get(id);
  if (proc) {
    proc.kill("SIGTERM");
    activeDownloads.delete(id);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle("get-active-downloads", () => {
  return Array.from(activeDownloads.keys());
});
