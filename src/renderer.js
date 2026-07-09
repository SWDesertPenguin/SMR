// Markdown parsing, sanitizing, and highlighting are provided by the preload
// (window.md) so the renderer needs no Node modules of its own. This file owns
// all tab/editor state; the main process is a stateless file service.

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
const linkLight = document.getElementById('hljs-light');
const linkDark = document.getElementById('hljs-dark');

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

function toEol(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

// --- Slugs + rendering -----------------------------------------------------
const slugCounts = new Map();
function slugify(text) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-') || 'section';
  const n = slugCounts.get(base) || 0;
  slugCounts.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function renderPreview(tab) {
  if (!tab) return;
  const keepScroll = elPreview.scrollTop;
  slugCounts.clear();
  elContent.innerHTML = window.md.parse(tab.el.value);
  assignHeadingIds();
  highlightCodeBlocks();
  buildToc();
  observeHeadings();
  elPreview.scrollTop = keepScroll;
}

function assignHeadingIds() {
  elContent.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if (!h.id) h.id = slugify(h.textContent);
  });
}

function highlightCodeBlocks() {
  elContent.querySelectorAll('pre code').forEach((block) => {
    const langClass = [...block.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.slice('language-'.length) : '';
    const res = window.md.highlight(block.textContent, lang);
    if (res.value) {
      block.innerHTML = res.value;
      block.classList.add('hljs');
      if (res.language && !langClass) block.classList.add(`language-${res.language}`);
    }
  });
}

function buildToc() {
  elTocList.innerHTML = '';
  const headings = elContent.querySelectorAll('h1, h2, h3, h4');
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
      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  elContent.querySelectorAll('h1, h2, h3, h4').forEach((h) => tocObserver.observe(h));
}

// Debounce live preview so fast typing doesn't re-parse on every keystroke.
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const tab = getActiveTab();
    if (tab) renderPreview(tab);
  }, 150);
}

// --- Tab creation / lifecycle ----------------------------------------------
function makeTab({ path = null, name, content = '' }) {
  const norm = content.replace(/\r\n/g, '\n');
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
    eol: /\r\n/.test(content) ? '\r\n' : '\n',
    el: ta,
    previewScroll: 0,
    conflict: false
  };

  ta.addEventListener('input', () => onEdit(tab));
  ta.addEventListener('keydown', (e) => handleEditorKeys(e, tab));
  elEditors.appendChild(ta);
  tabs.push(tab);
  return tab;
}

// Tab key inserts two spaces at the caret rather than moving focus.
function handleEditorKeys(e, tab) {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const ta = tab.el;
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    onEdit(tab);
  }
}

function onEdit(tab) {
  if (tab.id === activeId) scheduleRender();
  updateTabLabel(tab);
  syncDirty();
}

function openFile(data) {
  if (!data || typeof data.content !== 'string' || !data.path) return null;
  const existing = tabs.find((t) => t.path === data.path);
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
  tab.el.remove();
  tabs = tabs.filter((t) => t.id !== id);
  if (activeId === id) {
    const next = tabs[tabs.length - 1];
    activeId = next ? next.id : null;
  }
  afterTabsChange();
  if (activeId) switchTab(activeId);
  else showEmpty();
}

function switchTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  const cur = getActiveTab();
  if (cur && cur.id !== id) cur.previewScroll = elPreview.scrollTop;

  activeId = id;
  tabs.forEach((t) => { t.el.style.display = t.id === id ? 'block' : 'none'; });

  document.body.classList.remove('no-tabs');
  renderPreview(tab);
  elPreview.scrollTop = tab.previewScroll || 0;
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
  const res = await window.md.save(tab.path, toEol(text, tab.eol));
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
  const res = await window.md.saveDialog(toEol(text, tab.eol), suggested);
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
  const norm = rawContent.replace(/\r\n/g, '\n');
  tab.eol = /\r\n/.test(rawContent) ? '\r\n' : '\n';
  tab.saved = norm;
  tab.conflict = false;
  tab.el.value = norm;
  if (tab.id === activeId) renderPreview(tab);
  updateTabLabel(tab);
  syncDirty();
}

function onFileChanged(payload) {
  const tab = tabs.find((t) => t.path === payload.path);
  if (!tab) return;
  const norm = payload.content.replace(/\r\n/g, '\n');
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
  currentLayout = mode;
  document.body.classList.remove('layout-split', 'layout-preview', 'layout-editor');
  document.body.classList.add(`layout-${mode}`);
  localStorage.setItem('layout', mode);
  const tab = getActiveTab();
  if (tab && mode !== 'preview') tab.el.focus();
}

function cycleLayout() {
  const i = LAYOUTS.indexOf(currentLayout);
  setLayout(LAYOUTS[(i + 1) % LAYOUTS.length]);
}

// --- Open via dialog -------------------------------------------------------
async function openViaDialog() {
  const res = await window.md.openDialog();
  if (res && Array.isArray(res.files)) res.files.forEach(openFile);
}

// --- Drag and drop ---------------------------------------------------------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  elDropOverlay.classList.add('visible');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) elDropOverlay.classList.remove('visible');
});
window.addEventListener('drop', async (e) => {
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
  }
});

btnTheme.addEventListener('click', toggleTheme);
btnToc.addEventListener('click', toggleToc);
btnNew.addEventListener('click', newTab);
btnOpen.addEventListener('click', openViaDialog);
btnSave.addEventListener('click', saveActive);
btnLayout.addEventListener('click', cycleLayout);
btnNewTab.addEventListener('click', newTab);

// --- Initial state ---------------------------------------------------------
applyTheme(localStorage.getItem('theme') || 'light');
if (localStorage.getItem('tocHidden') === '1') document.body.classList.add('toc-hidden');
setLayout(localStorage.getItem('layout') || 'split');
showEmpty();
