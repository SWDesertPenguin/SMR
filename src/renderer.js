// Markdown parsing, sanitizing, and highlighting run here as ES modules so the
// preload can stay a pure IPC bridge in a sandboxed renderer (window.md). This
// file owns all tab/editor state; the main process is a stateless file service.

import { marked } from '../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
// highlight.js's own es/ entry points re-export a CommonJS build, which a
// browser can't load; the cdn-assets package ships the same common-language
// set as a single self-contained ES module.
import hljs from '../node_modules/@highlightjs/cdn-assets/es/highlight.min.js';

// Pure, DOM-free helpers live in pure.mjs so they can be unit-tested in Node.
import { proportional, clampTocWidth, clampSplitFraction, comboToHtml, toEol, makeSlugger, normalizeEol, detectEol, samePath, stripBom, withBom } from './pure.mjs';

// --- DOM handles -----------------------------------------------------------
const elContent = document.getElementById('content');
const elFilename = document.getElementById('filename');
const elTocList = document.getElementById('toc-list');
const elPreview = document.getElementById('preview-pane');
const elEditors = document.getElementById('editors');
const elTabs = document.getElementById('tabs');
const elDropOverlay = document.getElementById('drop-overlay');
const btnTheme = document.getElementById('btn-theme');
const btnToc = document.getElementById('btn-toc');
const btnNew = document.getElementById('btn-new');
const btnOpen = document.getElementById('btn-open');
const btnSave = document.getElementById('btn-save');
const btnLayout = document.getElementById('btn-layout');
const btnNewTab = document.getElementById('btn-newtab');
const btnHelp = document.getElementById('btn-help');
const linkLight = document.getElementById('hljs-light');
const linkDark = document.getElementById('hljs-dark');
const elBody = document.getElementById('body');
const elPanes = document.getElementById('panes');
const gutterToc = document.getElementById('gutter-toc');
const gutterSplit = document.getElementById('gutter-split');
const elHelpOverlay = document.getElementById('help-overlay');

// Platform-aware modifier label: ⌘ on macOS, Ctrl elsewhere.
const isMac = (window.md.platform || '') === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

// --- Tab state -------------------------------------------------------------
// Each tab keeps its own <textarea> in the DOM (hidden when inactive) so it owns
// a native undo stack, cursor, and scroll position. `saved` is the LF-normalized
// last-saved content; dirtiness is just (textarea value !== saved).
let tabs = [];
let activeId = null;
let nextId = 1;
let untitledCount = 0;
let lastDirtyCount = -1;

function getActiveTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

// textarea.value is always LF (HTML spec), and we store `saved` as LF, so this
// comparison is EOL-agnostic and a freshly opened CRLF file is not "dirty".
function isDirty(tab) {
  return tab.el.value !== tab.saved;
}

// --- Rendering -------------------------------------------------------------
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

// Markdown → sanitized HTML string. Styles are dropped here (and blocked by the
// CSP) so a document can't restyle the app chrome; `input` stays allowed for
// GFM task-list checkboxes.
function parseMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md), {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style']
  });
}

// Syntax-highlight a code block → { value: html, language }.
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

// Re-highlighting every block on each keystroke is the bulk of a render, and
// most blocks don't change between renders, so memoize by language + source.
const HIGHLIGHT_CACHE_MAX = 500;
const highlightCache = new Map();
function highlightCached(code, lang) {
  const key = `${lang}\u0000${code}`;
  let res = highlightCache.get(key);
  if (!res) {
    if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) highlightCache.clear();
    res = highlight(code, lang);
    highlightCache.set(key, res);
  }
  return res;
}

function renderPreview(tab) {
  if (!tab) return;
  const keepScroll = elPreview.scrollTop;
  elContent.innerHTML = parseMarkdown(tab.el.value);
  assignHeadingIds();
  highlightCodeBlocks();
  buildToc();
  observeHeadings();
  setScrollSilently(elPreview, keepScroll);
  tab.previewStale = false;
}

// Render the active tab's preview if it is on screen; in editor-only layout the
// pane is hidden, so just remember it is out of date for when it comes back.
function refreshPreview(tab) {
  if (!tab) return;
  if (currentLayout === 'editor') tab.previewStale = true;
  else renderPreview(tab);
}

function assignHeadingIds() {
  const slugify = makeSlugger();
  elContent.querySelectorAll(HEADINGS).forEach((h) => {
    if (!h.id) h.id = slugify(h.textContent);
  });
}

function highlightCodeBlocks() {
  elContent.querySelectorAll('pre code').forEach((block) => {
    const langClass = [...block.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.slice('language-'.length) : '';
    const res = highlightCached(block.textContent, lang);
    if (res.value) {
      block.innerHTML = res.value;
      block.classList.add('hljs');
      if (res.language && !langClass) block.classList.add(`language-${res.language}`);
    }
  });
}

function buildToc() {
  elTocList.innerHTML = '';
  const headings = elContent.querySelectorAll(HEADINGS);
  if (headings.length === 0) {
    elTocList.innerHTML = '<li class="toc-empty">No headings</li>';
    return;
  }
  headings.forEach((h) => {
    const li = document.createElement('li');
    li.className = `toc-${h.tagName.toLowerCase()}`;
    const a = document.createElement('a');
    a.textContent = h.textContent;
    a.href = `#${h.id}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.appendChild(a);
    elTocList.appendChild(li);
  });
}

// Highlight the active TOC entry while scrolling the preview.
const tocObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      elTocList.querySelectorAll('a').forEach((a) => {
        a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
      });
    });
  },
  { root: elPreview, rootMargin: '0px 0px -75% 0px', threshold: 0 }
);

function observeHeadings() {
  tocObserver.disconnect();
  elContent.querySelectorAll(HEADINGS).forEach((h) => tocObserver.observe(h));
}

// In-document links (#fragment). Heading ids carry an "md-" prefix, so a plain
// hash navigation wouldn't find them; resolve the fragment inside the preview.
elContent.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
  if (!a) return;
  e.preventDefault();
  let frag = a.getAttribute('href').slice(1);
  try { frag = decodeURIComponent(frag); } catch (_) { /* keep the raw fragment */ }
  if (!frag) return;
  const target = elContent.querySelector(`#${CSS.escape(`md-${frag}`)}`)
    || elContent.querySelector(`#${CSS.escape(frag)}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Debounce live preview so fast typing doesn't re-parse on every keystroke.
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  if (currentLayout === 'editor') {
    const tab = getActiveTab();
    if (tab) tab.previewStale = true;
    return;
  }
  renderTimer = setTimeout(() => refreshPreview(getActiveTab()), 150);
}

// --- Synchronized scrolling ------------------------------------------------
// In split view, scrolling either pane scrolls the other to the same relative
// position. Setting scrollTop fires a scroll event on the target, which would
// echo back into an infinite loop; each direction sets a one-shot lock that the
// echoed event consumes. We only arm the lock when the value actually changes,
// so a no-op set can't leave a lock stuck and swallow a later real scroll.
let lockEditor = false;
let lockPreview = false;

// Scroll `el` without triggering a sync back to the other pane.
function setScrollSilently(el, top) {
  if (Math.abs(el.scrollTop - top) < 0.5) return;
  if (el === elPreview) lockPreview = true;
  else lockEditor = true;
  el.scrollTop = top;
}

function onEditorScroll(ta) {
  // Only the active editor is visible, so only it can be scrolled by the user.
  if (currentLayout !== 'split' || ta !== getActiveTab()?.el) return;
  if (lockEditor) { lockEditor = false; return; }
  const target = proportional(ta, elPreview);
  if (target !== null) setScrollSilently(elPreview, target);
}

function onPreviewScroll() {
  if (currentLayout !== 'split') return;
  if (lockPreview) { lockPreview = false; return; }
  const ta = getActiveTab()?.el;
  if (!ta) return;
  const target = proportional(elPreview, ta);
  if (target !== null) setScrollSilently(ta, target);
}

elPreview.addEventListener('scroll', onPreviewScroll, { passive: true });

// --- Tab creation / lifecycle ----------------------------------------------
function makeTab({ path = null, name, content = '' }) {
  const { text, bom } = stripBom(content);
  const norm = normalizeEol(text);
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.spellcheck = false;
  ta.value = norm;
  ta.style.display = 'none';

  const tab = {
    id: nextId++,
    path,
    name,
    saved: norm,
    bom,
    eol: detectEol(text),
    el: ta,
    previewScroll: 0,
    previewStale: true,
    conflict: false
  };

  ta.addEventListener('input', () => onEdit(tab));
  ta.addEventListener('keydown', (e) => handleEditorKeys(e, tab));
  ta.addEventListener('blur', () => { tabPassThrough = false; });
  ta.addEventListener('scroll', () => onEditorScroll(ta), { passive: true });
  elEditors.appendChild(ta);
  tabs.push(tab);
  return tab;
}

// Tab key inserts two spaces at the caret rather than moving focus. Shift+Tab is
// left alone, and Escape arms a one-shot escape hatch so the next Tab moves focus
// out of the editor (otherwise keyboard users would be trapped in it).
let tabPassThrough = false;
function handleEditorKeys(e, tab) {
  if (e.key === 'Escape') { tabPassThrough = true; return; }
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (tabPassThrough) { tabPassThrough = false; return; }
    e.preventDefault();
    const ta = tab.el;
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    onEdit(tab);
    return;
  }
  // Any other real keypress disarms it; a bare modifier press doesn't count.
  if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) tabPassThrough = false;
}

function onEdit(tab) {
  if (tab.id === activeId) scheduleRender();
  updateTabLabel(tab);
  syncDirty();
}

function openFile(data) {
  if (!data || typeof data.content !== 'string' || !data.path) return null;
  const existing = tabs.find((t) => samePath(t.path, data.path, window.md.platform));
  if (existing) {
    switchTab(existing.id);
    return existing;
  }
  const tab = makeTab({ path: data.path, name: data.name, content: data.content });
  afterTabsChange();
  switchTab(tab.id);
  return tab;
}

function newTab() {
  untitledCount++;
  const tab = makeTab({ path: null, name: `Untitled-${untitledCount}`, content: '' });
  afterTabsChange();
  switchTab(tab.id);
  if (currentLayout === 'preview') setLayout('split');
  tab.el.focus();
}

async function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (isDirty(tab)) {
    const choice = await window.md.confirmClose(tab.name);
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const ok = await saveTab(tab);
      if (!ok) return; // save dialog cancelled or write failed → keep the tab open
    }
  }
  const idx = tabs.findIndex((t) => t.id === id);
  const wasActive = activeId === id;
  tab.el.remove();
  tabs = tabs.filter((t) => t.id !== id);
  afterTabsChange();
  if (!wasActive) return;
  // Hand off to the neighbor now sitting at the closed slot (or the last tab).
  // Clearing activeId first keeps switchTab from saving the closed tab's scroll
  // onto the wrong tab.
  const next = tabs[idx] || tabs[tabs.length - 1];
  activeId = null;
  if (next) switchTab(next.id);
  else showEmpty();
}

function switchTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  // The preview pane is display:none in editor layout, where scrollTop reads 0,
  // so only record it while it is actually showing.
  const cur = getActiveTab();
  if (cur && currentLayout !== 'editor') cur.previewScroll = elPreview.scrollTop;

  activeId = id;
  tabs.forEach((t) => { t.el.style.display = t.id === id ? 'block' : 'none'; });

  document.body.classList.remove('no-tabs');
  refreshPreview(tab);
  if (currentLayout !== 'editor') setScrollSilently(elPreview, tab.previewScroll || 0);
  updateActiveUi();
  renderTabBar();
  if (currentLayout !== 'preview') tab.el.focus();
}

// Reconcile watched paths, the no-tabs class, the tab bar, and the dirty count
// after any change to the set of open tabs.
function afterTabsChange() {
  window.md.setWatched(tabs.filter((t) => t.path).map((t) => t.path));
  document.body.classList.toggle('no-tabs', tabs.length === 0);
  renderTabBar();
  syncDirty();
}

function showEmpty() {
  activeId = null;
  elFilename.textContent = 'No file open';
  document.title = 'SMR';
  elContent.innerHTML = '';
  elTocList.innerHTML = '';
  document.body.classList.add('no-tabs');
  renderTabBar();
  syncDirty();
}

// --- Tab bar + title UI ----------------------------------------------------
function renderTabBar() {
  elTabs.innerHTML = '';
  tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.id = String(tab.id);
    el.classList.toggle('active', tab.id === activeId);
    el.classList.toggle('conflict', tab.conflict);
    el.title = tab.conflict ? `${tab.path || tab.name} — changed on disk` : (tab.path || tab.name);

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = (isDirty(tab) ? '• ' : '') + tab.name;
    el.appendChild(name);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close tab (Ctrl+W)';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
    el.appendChild(close);

    el.addEventListener('click', () => switchTab(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab.id); }
    });
    elTabs.appendChild(el);
  });
}

function updateTabLabel(tab) {
  const el = elTabs.querySelector(`.tab[data-id="${tab.id}"]`);
  if (el) {
    el.classList.toggle('conflict', tab.conflict);
    const name = el.querySelector('.tab-name');
    if (name) name.textContent = (isDirty(tab) ? '• ' : '') + tab.name;
  }
  if (tab.id === activeId) updateActiveUi();
}

function updateActiveUi() {
  const tab = getActiveTab();
  if (!tab) return;
  elFilename.textContent = tab.path || tab.name;
  document.title = `${isDirty(tab) ? '• ' : ''}${tab.name} — SMR`;
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  switchTab(next.id);
}

// --- Saving ----------------------------------------------------------------
async function saveTab(tab) {
  if (!tab.path) return saveTabAs(tab);
  const text = tab.el.value;
  const res = await window.md.save(tab.path, toEol(withBom(text, tab.bom), tab.eol));
  if (res && res.ok) {
    tab.saved = text;
    tab.conflict = false;
    updateTabLabel(tab);
    syncDirty();
    return true;
  }
  return false;
}

async function saveTabAs(tab) {
  const text = tab.el.value;
  const suggested = tab.path || (tab.name.endsWith('.md') ? tab.name : `${tab.name}.md`);
  const res = await window.md.saveDialog(toEol(withBom(text, tab.bom), tab.eol), suggested);
  if (res && res.path) {
    tab.path = res.path;
    tab.name = res.name;
    tab.saved = text;
    tab.conflict = false;
    afterTabsChange(); // path changed → update watchers
    updateTabLabel(tab);
    syncDirty();
    return true;
  }
  return false;
}

function saveActive() {
  const tab = getActiveTab();
  if (tab) saveTab(tab);
}

function saveActiveAs() {
  const tab = getActiveTab();
  if (tab) saveTabAs(tab);
}

async function reloadActive() {
  const tab = getActiveTab();
  if (!tab || !tab.path) return;
  if (isDirty(tab) && !window.confirm('Discard your changes and reload this file from disk?')) return;
  const res = await window.md.read(tab.path);
  if (res && typeof res.content === 'string') applyExternal(tab, res.content);
}

// Replace a tab's content from disk (reload, or a clean external change).
// Resetting textarea.value clears that tab's undo stack, which is acceptable
// when the file is being reloaded wholesale from disk.
function applyExternal(tab, rawContent) {
  const { text, bom } = stripBom(rawContent);
  const norm = normalizeEol(text);
  tab.eol = detectEol(text);
  tab.bom = bom;
  tab.saved = norm;
  tab.conflict = false;
  tab.el.value = norm;
  if (tab.id === activeId) refreshPreview(tab);
  updateTabLabel(tab);
  syncDirty();
}

function onFileChanged(payload) {
  const tab = tabs.find((t) => samePath(t.path, payload.path, window.md.platform));
  if (!tab) return;
  const norm = normalizeEol(stripBom(payload.content).text);
  if (norm === tab.saved) return; // our own save, or a no-op write
  if (isDirty(tab)) {
    // External change collides with local edits — flag it, don't clobber.
    tab.conflict = true;
    updateTabLabel(tab);
  } else {
    applyExternal(tab, payload.content);
  }
}

function syncDirty() {
  const n = tabs.filter(isDirty).length;
  if (n !== lastDirtyCount) {
    lastDirtyCount = n;
    window.md.notifyDirty(n);
  }
}

// Main intercepted a window close because tabs are unsaved. Offer one Save All /
// Don't Save / Cancel choice, reuse the per-tab save path, then let main proceed.
async function handleQuitRequested() {
  const dirty = tabs.filter(isDirty);
  if (dirty.length === 0) { window.md.forceQuit(); return; }
  const choice = await window.md.confirmQuit(dirty.length);
  if (choice === 'cancel') return;
  if (choice === 'save') {
    for (const tab of dirty) {
      switchTab(tab.id); // surface the tab a Save As dialog would target
      const ok = await saveTab(tab);
      if (!ok) return; // a save was cancelled or failed → abort the quit
    }
  }
  window.md.forceQuit();
}

// --- Theme -----------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  linkLight.disabled = dark;
  linkDark.disabled = !dark;
  btnTheme.textContent = dark ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// --- TOC visibility --------------------------------------------------------
function toggleToc() {
  document.body.classList.toggle('toc-hidden');
  localStorage.setItem('tocHidden', document.body.classList.contains('toc-hidden') ? '1' : '0');
}

// --- Layout ----------------------------------------------------------------
const LAYOUTS = ['split', 'preview', 'editor'];
let currentLayout = 'split';

function setLayout(mode) {
  const tab = getActiveTab();
  const wasHidden = currentLayout === 'editor';
  // Hiding the preview resets its scrollTop to 0, so bank the position first.
  if (tab && !wasHidden && mode === 'editor') tab.previewScroll = elPreview.scrollTop;

  currentLayout = mode;
  document.body.classList.remove('layout-split', 'layout-preview', 'layout-editor');
  document.body.classList.add(`layout-${mode}`);
  localStorage.setItem('layout', mode);

  // The preview is showing again: catch it up if edits landed while it was hidden.
  if (tab && wasHidden && mode !== 'editor') {
    if (tab.previewStale) renderPreview(tab);
    setScrollSilently(elPreview, tab.previewScroll || 0);
  }
  if (tab && mode !== 'preview') tab.el.focus();
}

function cycleLayout() {
  const i = LAYOUTS.indexOf(currentLayout);
  setLayout(LAYOUTS[(i + 1) % LAYOUTS.length]);
}

// --- Resizable panes -------------------------------------------------------
// Each gutter drives one CSS variable. Pointer capture keeps move/up events on
// the gutter even while the cursor is over a textarea, and the values persist.
function initGutter(gutter, onDrag) {
  gutter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { gutter.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }
    gutter.classList.add('dragging');
    document.body.classList.add('resizing');

    const move = (ev) => onDrag(ev.clientX);
    const end = () => {
      gutter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', end);
      gutter.removeEventListener('pointercancel', end);
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', end);
    gutter.addEventListener('pointercancel', end);
  });
}

function setTocWidth(px) {
  const w = clampTocWidth(px, window.innerWidth * 0.6);
  document.documentElement.style.setProperty('--toc-width', `${w}px`);
  localStorage.setItem('tocWidth', String(w));
}

function setSplitPos(fraction) {
  const pct = `${(clampSplitFraction(fraction) * 100).toFixed(2)}%`;
  document.documentElement.style.setProperty('--split-pos', pct);
  localStorage.setItem('splitPos', pct);
}

initGutter(gutterToc, (clientX) => {
  setTocWidth(clientX - elBody.getBoundingClientRect().left);
});
initGutter(gutterSplit, (clientX) => {
  const rect = elPanes.getBoundingClientRect();
  if (rect.width > 0) setSplitPos((clientX - rect.left) / rect.width);
});

// --- Help overlay ----------------------------------------------------------
// One row per shortcut; MOD is substituted with ⌘ or Ctrl and each key token
// is wrapped in a <kbd> chip.
const SHORTCUTS = [
  ['New file', 'MOD+N'],
  ['Open file', 'MOD+O'],
  ['Save', 'MOD+S'],
  ['Save As', 'MOD+Shift+S'],
  ['Reload from disk', 'MOD+R'],
  ['Close tab', 'MOD+W'],
  ['Next / previous tab', 'MOD+PgDn / MOD+PgUp'],
  ['Cycle layout', 'MOD+E'],
  ['Toggle dark mode', 'MOD+D'],
  ['Toggle contents', 'MOD+T']
];

function buildHelp() {
  const body = document.getElementById('help-shortcuts-body');
  if (body) {
    body.innerHTML = SHORTCUTS
      .map(([label, combo]) => `<tr><td>${label}</td><td>${comboToHtml(combo, MOD)}</td></tr>`)
      .join('');
  }
  const gh = document.getElementById('help-github');
  if (gh) {
    gh.addEventListener('click', (e) => {
      e.preventDefault();
      window.md.openExternal('https://github.com/SWDesertPenguin/SMR');
    });
  }
  document.getElementById('help-close')?.addEventListener('click', hideHelp);
  elHelpOverlay.addEventListener('click', (e) => {
    if (e.target === elHelpOverlay) hideHelp();
  });
}

function showHelp() { elHelpOverlay.hidden = false; }
function hideHelp() { elHelpOverlay.hidden = true; }
function toggleHelp() { elHelpOverlay.hidden ? showHelp() : hideHelp(); }

// Rewrite Windows-style hints for macOS: ⌘ in tooltips and empty-state kbds.
function localizeShortcuts() {
  if (!isMac) return;
  document.querySelectorAll('[title]').forEach((el) => {
    if (el.title.includes('Ctrl+')) el.title = el.title.replaceAll('Ctrl+', '⌘');
  });
  document.querySelectorAll('#empty-state kbd').forEach((k) => {
    if (k.textContent === 'Ctrl') k.textContent = '⌘';
  });
}

// --- Open via dialog -------------------------------------------------------
async function openViaDialog() {
  const res = await window.md.openDialog();
  if (res && Array.isArray(res.files)) res.files.forEach(openFile);
}

// --- Drag and drop ---------------------------------------------------------
// Only file drags are ours. Anything else (e.g. selected text dragged inside the
// editor) must reach the browser untouched so native text drag-and-drop works.
function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  elDropOverlay.classList.add('visible');
});
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) elDropOverlay.classList.remove('visible');
});
window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  elDropOverlay.classList.remove('visible');
  for (const file of [...e.dataTransfer.files]) {
    const p = window.md.getPathForFile(file);
    if (!p) continue;
    try {
      const res = await window.md.openPath(p);
      if (res && res.path) openFile(res);
    } catch (err) {
      console.error('open failed:', err);
    }
  }
});

// --- Wire up IPC + controls ------------------------------------------------
window.md.onOpenTabs((list) => { (list || []).forEach(openFile); });
window.md.onFileChanged(onFileChanged);
window.md.onQuitRequested(handleQuitRequested);
window.md.onMenuAction((action) => {
  switch (action) {
    case 'new': newTab(); break;
    case 'open': openViaDialog(); break;
    case 'save': saveActive(); break;
    case 'save-as': saveActiveAs(); break;
    case 'reload': reloadActive(); break;
    case 'close-tab': if (activeId) closeTab(activeId); break;
    case 'next-tab': cycleTab(1); break;
    case 'prev-tab': cycleTab(-1); break;
    case 'toggle-theme': toggleTheme(); break;
    case 'toggle-toc': toggleToc(); break;
    case 'toggle-layout': cycleLayout(); break;
    case 'help': toggleHelp(); break;
  }
});

btnTheme.addEventListener('click', toggleTheme);
btnToc.addEventListener('click', toggleToc);
btnNew.addEventListener('click', newTab);
btnOpen.addEventListener('click', openViaDialog);
btnSave.addEventListener('click', saveActive);
btnLayout.addEventListener('click', cycleLayout);
btnNewTab.addEventListener('click', newTab);
btnHelp.addEventListener('click', toggleHelp);

// Escape closes the help overlay.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !elHelpOverlay.hidden) hideHelp();
});

// --- Initial state ---------------------------------------------------------
applyTheme(localStorage.getItem('theme') || 'light');
if (localStorage.getItem('tocHidden') === '1') document.body.classList.add('toc-hidden');
setLayout(localStorage.getItem('layout') || 'split');

// Restore persisted pane sizes (clamped in case the window is now narrower).
const savedTocW = parseFloat(localStorage.getItem('tocWidth'));
if (Number.isFinite(savedTocW)) setTocWidth(savedTocW);
const savedSplit = parseFloat(localStorage.getItem('splitPos'));
if (Number.isFinite(savedSplit)) setSplitPos(savedSplit / 100);

buildHelp();
localizeShortcuts();
showEmpty();
