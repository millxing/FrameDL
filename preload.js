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
  getHistory: () => ipcRenderer.invoke("get-history"),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  openDownloadFolder: () => ipcRenderer.invoke("open-download-folder"),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),

  startDownload: (options) => ipcRenderer.invoke("start-download", options),
  cancelDownload: (id) => ipcRenderer.invoke("cancel-download", id),
  getActiveDownloads: () => ipcRenderer.invoke("get-active-downloads"),

  onExternalDownload: (callback) => {
    ipcRenderer.on("external-download", (_, data) => callback(data));
  },

  onDownloadProgress: (id, callback) => {
    const channel = `download-progress-${id}`;
    const listener = (_, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});