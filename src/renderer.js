// Markdown parsing, sanitizing, and highlighting are provided by the preload
// (window.md) so the renderer needs no Node modules of its own.

// --- DOM handles -----------------------------------------------------------
const elContent = document.getElementById('content');
const elEmpty = document.getElementById('empty-state');
const elFilename = document.getElementById('filename');
const elTocList = document.getElementById('toc-list');
const elMain = document.getElementById('main');
const elDropOverlay = document.getElementById('drop-overlay');
const btnTheme = document.getElementById('btn-theme');
const btnToc = document.getElementById('btn-toc');
const linkLight = document.getElementById('hljs-light');
const linkDark = document.getElementById('hljs-dark');

// Stable slug ids for headings so the TOC can link to them.
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

// --- Rendering -------------------------------------------------------------
function render(markdown) {
  slugCounts.clear();
  const clean = window.md.parse(markdown);

  // Preserve scroll on live re-render of the same file.
  const prevScroll = elMain.scrollTop;

  elContent.innerHTML = clean;
  assignHeadingIds();
  highlightCodeBlocks();
  buildToc();

  elMain.scrollTop = prevScroll;
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

// Highlight the active TOC entry while scrolling.
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
  { rootMargin: '0px 0px -75% 0px', threshold: 0 }
);

function observeHeadings() {
  tocObserver.disconnect();
  elContent.querySelectorAll('h1, h2, h3, h4').forEach((h) => tocObserver.observe(h));
}

// --- File state UI ---------------------------------------------------------
function showFile(payload) {
  elFilename.textContent = payload.name;
  document.title = `${payload.name} — SMR`;
  render(payload.content);
  observeHeadings();
  elEmpty.style.display = 'none';
  elContent.style.display = 'block';
}

function showEmpty() {
  elFilename.textContent = 'No file open';
  document.title = 'SMR';
  elContent.innerHTML = '';
  elTocList.innerHTML = '';
  elEmpty.style.display = 'flex';
  elContent.style.display = 'none';
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
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  elDropOverlay.classList.remove('visible');
  const file = e.dataTransfer.files[0];
  if (file) {
    const p = window.md.getPathForFile(file);
    if (p) window.md.openPath(p).catch((err) => console.error('open failed:', err));
  }
});

// --- Wire up IPC + controls ------------------------------------------------
window.md.onFileLoaded((payload) => showFile(payload));
window.md.onFileClosed(() => showEmpty());
window.md.onMenuAction((action) => {
  if (action === 'toggle-theme') toggleTheme();
  else if (action === 'toggle-toc') toggleToc();
});

btnTheme.addEventListener('click', toggleTheme);
btnToc.addEventListener('click', toggleToc);

// --- Initial state ---------------------------------------------------------
applyTheme(localStorage.getItem('theme') || 'light');
if (localStorage.getItem('tocHidden') === '1') document.body.classList.add('toc-hidden');
showEmpty();
