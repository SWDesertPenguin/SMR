const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Read once at load, before any page script runs. This is the app's only
// synchronous IPC call; everything after it is async.
let settings = {};
try {
  settings = ipcRenderer.sendSync('settings:get') || {};
} catch (_) { /* start from defaults */ }

// Minimal, explicit API surface for the renderer. No direct fs/ipc exposure.
contextBridge.exposeInMainWorld('md', {
  // Host platform, so the renderer can show ⌘ vs Ctrl and adapt copy.
  platform: process.platform,

  // Saved preferences as of launch, plus systemDark (the OS color scheme).
  settings,

  // Persist one preference. Main validates the key and value before writing.
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { [key]: value }),

  // Open an external URL (e.g. the project's GitHub page) in the system browser.
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Resolve the absolute path of a dropped File object (replaces File.path).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return '';
    }
  },

  // Renderer → main: file service (all return plain result objects).
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveDialog: (content, name) => ipcRenderer.invoke('dialog:save', { content, name }),
  openPath: (filePath) => ipcRenderer.invoke('file:open-path', filePath),
  // Open the Markdown file a relative link points at; href resolves against docPath's folder.
  openRelative: (docPath, href) => ipcRenderer.invoke('file:open-relative', { docPath, href }),
  save: (filePath, content) => ipcRenderer.invoke('file:save', { path: filePath, content }),
  read: (filePath) => ipcRenderer.invoke('file:read', filePath),
  setWatched: (paths) => ipcRenderer.invoke('watch:set', paths),
  confirmClose: (name) => ipcRenderer.invoke('dialog:confirm-close', name),
  confirmQuit: (n) => ipcRenderer.invoke('dialog:confirm-quit', n),
  confirmReload: (name) => ipcRenderer.invoke('dialog:confirm-reload', name),

  // Renderer → main: keep the main process's unsaved-count mirror in sync so the
  // window-close handler can decide synchronously.
  notifyDirty: (n) => ipcRenderer.send('app:dirty', n),

  // Renderer → main: the quit flow finished; proceed with closing the window.
  forceQuit: () => ipcRenderer.send('app:force-quit'),

  // Renderer → main: the quit flow was cancelled or a save failed; abandon any
  // install that was waiting on it.
  cancelQuit: () => ipcRenderer.send('app:quit-cancelled'),

  // Main → renderer: open one or more files (launch arg, file association, recent).
  onOpenTabs: (cb) => {
    ipcRenderer.on('tabs:open', (_evt, payload) => cb(payload));
  },

  // Main → renderer: a watched file changed on disk.
  onFileChanged: (cb) => {
    ipcRenderer.on('file:changed', (_evt, payload) => cb(payload));
  },

  // Main → renderer: a watched file is gone from disk and the watcher was dropped.
  onFileGone: (cb) => {
    ipcRenderer.on('file:gone', (_evt, payload) => cb(payload));
  },

  // Main → renderer: the window is closing with unsaved tabs; run the quit flow.
  onQuitRequested: (cb) => {
    ipcRenderer.on('app:quit-requested', () => cb());
  },

  // Main → renderer: a menu item was activated.
  onMenuAction: (cb) => {
    ipcRenderer.on('menu:action', (_evt, action) => cb(action));
  }
});
