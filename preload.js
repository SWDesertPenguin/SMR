const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Minimal, explicit API surface for the renderer. No direct fs/ipc exposure.
contextBridge.exposeInMainWorld('md', {
  // Host platform, so the renderer can show ⌘ vs Ctrl and adapt copy.
  platform: process.platform,

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
  save: (filePath, content) => ipcRenderer.invoke('file:save', { path: filePath, content }),
  read: (filePath) => ipcRenderer.invoke('file:read', filePath),
  setWatched: (paths) => ipcRenderer.invoke('watch:set', paths),
  confirmClose: (name) => ipcRenderer.invoke('dialog:confirm-close', name),
  confirmQuit: (n) => ipcRenderer.invoke('dialog:confirm-quit', n),

  // Renderer → main: keep the main process's unsaved-count mirror in sync so the
  // window-close handler can decide synchronously.
  notifyDirty: (n) => ipcRenderer.send('app:dirty', n),

  // Renderer → main: the quit flow finished; proceed with closing the window.
  forceQuit: () => ipcRenderer.send('app:force-quit'),

  // Main → renderer: open one or more files (launch arg, file association, recent).
  onOpenTabs: (cb) => {
    ipcRenderer.on('tabs:open', (_evt, payload) => cb(payload));
  },

  // Main → renderer: a watched file changed on disk.
  onFileChanged: (cb) => {
    ipcRenderer.on('file:changed', (_evt, payload) => cb(payload));
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
