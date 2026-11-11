const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ytdlp", {
  install: () => ipcRenderer.invoke("install-ytdlp"),
  update: () => ipcRenderer.invoke("update-ytdlp"),
  getVersion: () => ipcRenderer.invoke("get-version"),

  setCookieBrowser: (browser) =>
    ipcRenderer.invoke("set-cookie-browser", browser),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  selectDownloadFolder: () => ipcRenderer.invoke("select-download-folder"),
  setVideoCodec: (codec) => ipcRenderer.invoke("set-video-codec", codec),
  setFilenameTemplate: (template) =>
    ipcRenderer.invoke("set-filename-template", template),

  updateDependencies: () => ipcRenderer.invoke("update-dependencies"),
  getDiskSpace: () => ipcRenderer.invoke("get-disk-space"),
  getSessionStart: () => ipcRenderer.invoke("get-session-start"),
  getHistory: () => ipcRenderer.invoke("get-history"),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  openDownloadFolder: () => ipcRenderer.invoke("open-download-folder"),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),

  getQueue: () => ipcRenderer.invoke("queue-get"),
  addToQueue: (item) => ipcRenderer.invoke("queue-add", item),
  removeFromQueue: (id) => ipcRenderer.invoke("queue-remove", id),
  clearQueue: () => ipcRenderer.invoke("queue-clear"),
  cancelDownload: (id) => ipcRenderer.invoke("cancel-download", id),

  onQueueChanged: (callback) => {
    ipcRenderer.on("queue-changed", (_, data) => callback(data));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on("download-progress", (_, data) => callback(data));
  },
});