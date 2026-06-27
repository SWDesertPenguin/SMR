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
  // Main → renderer: a file was loaded (or live-reloaded).
  onFileLoaded: (cb) => {
    ipcRenderer.on('file:loaded', (_evt, payload) => cb(payload));
  },

  // Main → renderer: the current file was closed.
  onFileClosed: (cb) => {
    ipcRenderer.on('file:closed', () => cb());
  },

  // Main → renderer: a menu item was activated (toggle-theme, toggle-toc).
  onMenuAction: (cb) => {
    ipcRenderer.on('menu:action', (_evt, action) => cb(action));
  },

  // Renderer → main: open a file by path (used for drag-and-drop).
  openPath: (filePath) => ipcRenderer.invoke('file:open-path', filePath),

  // Resolve the absolute path of a dropped File object (replaces File.path).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return (file && file.path) || '';
    }
  },

  // Markdown → sanitized HTML string.
  parse: (markdown) => DOMPurify.sanitize(marked.parse(markdown), { ADD_ATTR: ['target'] }),

  // Syntax-highlight a code block → { value: html, language }.
  highlight
});
