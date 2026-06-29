const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const hljs = require('highlight.js/lib/common');

// DOMPurify needs a DOM; the preload shares the renderer's window.
const DOMPurify = createDOMPurify(window);

marked.setOptions({ gfm: true, breaks: false });

function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return { value: hljs.highlight(code, { language: lang }).value, language: lang };
    } catch (_) { /* fall through */ }
  }
  try {
    const r = hljs.highlightAuto(code);
    return { value: r.value, language: r.language || '' };
  } catch (_) {
    return { value: '', language: '' };
  }
}

// Minimal, explicit API surface for the renderer. No direct fs/ipc exposure.
contextBridge.exposeInMainWorld('md', {
  // Markdown → sanitized HTML string.
  parse: (markdown) => DOMPurify.sanitize(marked.parse(markdown), { ADD_ATTR: ['target'] }),

  // Syntax-highlight a code block → { value: html, language }.
  highlight,

  // Resolve the absolute path of a dropped File object (replaces File.path).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return (file && file.path) || '';
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

  // Renderer → main: keep the main process's unsaved-count mirror in sync so the
  // window-close handler can decide synchronously.
  notifyDirty: (n) => ipcRenderer.send('app:dirty', n),

  // Main → renderer: open one or more files (launch arg, file association, recent).
  onOpenTabs: (cb) => {
    ipcRenderer.on('tabs:open', (_evt, payload) => cb(payload));
  },

  // Main → renderer: a watched file changed on disk.
  onFileChanged: (cb) => {
    ipcRenderer.on('file:changed', (_evt, payload) => cb(payload));
  },

  // Main → renderer: a menu item was activated.
  onMenuAction: (cb) => {
    ipcRenderer.on('menu:action', (_evt, action) => cb(action));
  }
});
