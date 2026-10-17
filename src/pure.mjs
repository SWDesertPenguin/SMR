// Pure, DOM-free helpers shared by the renderer (src/renderer.js), the main
// process (main.js, through require) and the unit tests (test/*.test.mjs). Nothing
// here may touch the DOM, window, IPC or a Node built-in, and nothing may use
// top-level await: the renderer loads this file as a browser module, and main
// loads it with require(), which needs Node 22.12+ (Electron 44 bundles Node 24).

// Proportional scroll target: map the source pane's scroll fraction onto the
// destination pane's scrollable range. Returns null if either can't scroll.
export function proportional(src, dst) {
  const srcMax = src.scrollHeight - src.clientHeight;
  const dstMax = dst.scrollHeight - dst.clientHeight;
  if (srcMax <= 0 || dstMax <= 0) return null;
  return (src.scrollTop / srcMax) * dstMax;
}

// Clamp a table-of-contents width (px) to [140, maxWidth] and round it.
export function clampTocWidth(px, maxWidth) {
  return Math.round(Math.max(140, Math.min(px, maxWidth)));
}

// Clamp the editor/preview split fraction to [0.15, 0.85] so neither pane
// collapses.
export function clampSplitFraction(f) {
  return Math.max(0.15, Math.min(f, 0.85));
}

// A stored theme is only trusted when it is exactly 'light' or 'dark'.
export function validTheme(v) {
  return v === 'light' || v === 'dark' ? v : null;
}

// The theme to start with: the settings file, then the old localStorage value, then
// the OS color scheme. `migrate` is true when the answer came from localStorage and
// should be written to settings; the OS fallback is deliberately not persisted, so
// the app keeps following the system until the user picks a theme.
export function resolveTheme(settingsTheme, storedTheme, systemDark) {
  const fromSettings = validTheme(settingsTheme);
  if (fromSettings) return { theme: fromSettings, migrate: false };
  const fromStorage = validTheme(storedTheme);
  if (fromStorage) return { theme: fromStorage, migrate: true };
  return { theme: systemDark ? 'dark' : 'light', migrate: false };
}

// A stored layout name if it is one of `layouts`, otherwise the fallback.
export function validLayout(v, layouts, fallback) {
  return layouts.includes(v) ? v : fallback;
}

// Render a shortcut combo like "MOD+Shift+S" into <kbd> chips, substituting the
// platform modifier (⌘ or Ctrl) for MOD and splitting on '+' and ' / '.
export function comboToHtml(combo, mod) {
  return combo
    .replaceAll('MOD', mod)
    .split(' / ')
    .map((part) => part.split('+').map((k) => `<kbd>${k}</kbd>`).join('+'))
    .join(' / ');
}

// Build a per-document heading-id generator. Ids are Unicode-aware, prefixed with
// "md-" so they can't collide with app element ids (#body, #tabs, #content...),
// and de-duplicated with a numeric suffix. Call once per render so counts reset.
export function makeSlugger() {
  const counts = new Map();
  return function slugify(text) {
    const base = 'md-' + (text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section');
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

// Collapse CRLF and lone CR to LF. A textarea does the same to its value, so
// `saved` has to be normalized the same way or a lone-CR file opens dirty.
export function normalizeEol(text) {
  return text.replace(/\r\n?/g, '\n');
}

// The end-of-line style to write back: CRLF if the file used any, else LF.
export function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

// Apply the target end-of-line style before writing. Idempotent, so text that
// already contains CRLF is not turned into CRCRLF.
export function toEol(text, eol) {
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
}

// Whether two absolute paths name the same file. Windows paths are
// case-insensitive, so `C:\Notes\A.md` and `c:\notes\a.md` are one tab there; every
// other platform compares exactly. Main hands the renderer path.resolve()d paths,
// so separators and `..` segments are already normalized.
export function samePath(a, b, platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Split a leading UTF-8 byte-order mark off file content. A BOM left in the text
// breaks the first heading and would be written back on every save, so the tab
// keeps it as a flag and withBom() restores it when saving.
export function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? { text: text.slice(1), bom: true } : { text, bom: false };
}

// Re-attach the BOM that stripBom() removed. Never doubles an existing one.
export function withBom(text, bom) {
  return bom && text.charCodeAt(0) !== 0xFEFF ? `\uFEFF${text}` : text;
}

// A URL parser drops tabs, newlines and edge whitespace, and reads a backslash as a
// slash, so `ht\ttps://x` and `\\host\x.png` are not what they look like. Scheme and
// host tests below run on this squashed form; the attribute itself is never altered.
function squashUrl(s) {
  // The control range is the point: URL parsing drops exactly these characters.
  // eslint-disable-next-line no-control-regex
  return (typeof s === 'string' ? s : '').replace(/[\u0000-\u0020]/g, '').replace(/\\/g, '/');
}

// How the preview treats an <img src>, judged on the raw attribute as written:
// 'data' loads as is, 'remote' (any http(s) URL, or protocol-relative) is gated behind
// the remote-images toggle, 'empty' is skipped, and anything else names a file beside
// the document. The slashes after `https:` are not required to be a URL: `https:host/x`
// and `https:/host/x` both reach the host, so the scheme alone decides.
export function classifyImageSrc(src) {
  const s = squashUrl(src);
  if (s === '') return 'empty';
  if (/^data:/i.test(s)) return 'data';
  if (/^(https?:|\/\/)/i.test(s)) return 'remote';
  return 'local';
}

// The smr-doc:// URL main serves a document's relative image from. `src` is the
// raw attribute, percent-encoded again here so it survives as one query value.
export function smrDocUrl(docPath, src) {
  return `smr-doc://local/?doc=${encodeURIComponent(docPath)}&rel=${encodeURIComponent(src)}`;
}

// What a click on a preview link should do, judged on the raw href: 'anchor' scrolls
// inside the preview, 'external' goes to the system browser, 'markdown' opens a
// sibling document as a tab, and 'other' is swallowed. A scheme of two or more
// letters marks a URL, so a Windows drive path (`C:\notes\a.md`) is not mistaken for one.
export function classifyHref(href) {
  const h = squashUrl(href);
  if (h.startsWith('#')) return 'anchor';
  if (/^(https?:|mailto:)/i.test(h)) return 'external';
  if (/^[a-z][a-z0-9+.-]+:/i.test(h)) return 'other';
  return /\.(md|markdown|mdown|mkd)$/i.test(h.replace(/[?#].*$/, '')) ? 'markdown' : 'other';
}

// --- Tabs --------------------------------------------------------------------

// The name offered in Save As for a tab that has no path yet: the tab's own name,
// with .md added unless it already ends that way (the check is case-sensitive).
export function suggestedName(name) {
  return name.endsWith('.md') ? name : `${name}.md`;
}

// The index `dir` (1 or -1) steps from `current`, wrapping at both ends. Plain
// arithmetic: callers skip it when there are fewer than two tabs.
export function cycleIndex(length, current, dir) {
  return (current + dir + length) % length;
}

// Which tab to show after one closes, as an index into the tabs that remain
// (`length` counts them, so it is the list after the close). The tab that slid into
// the closed slot wins, then the last one; -1 means no tabs are left.
export function neighborAfterClose(length, closedIndex) {
  if (length <= 0) return -1;
  return closedIndex >= 0 && closedIndex < length ? closedIndex : length - 1;
}

// --- Files (used by main.js) -------------------------------------------------

// The reader only deals in Markdown. This list is the single source of truth for
// the dialog filters and the per-path extension check; package.json's
// fileAssociations has to name the same extensions (a test compares them).
export const MD_EXTS = ['md', 'markdown', 'mdown', 'mkd'];

// Whether a path names a Markdown file, by its last extension. Mirrors
// path.extname without importing it: a name that is only a dot-extension (`.md`) has
// none, and trailing separators are ignored. Both separators count on every
// platform, so a POSIX file literally named `dir\.md` is the one case that differs.
export function isMarkdown(filePath) {
  if (typeof filePath !== 'string') return false;
  const base = filePath.replace(/[/\\]+$/, '').split(/[/\\]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 && MD_EXTS.includes(base.slice(dot + 1).toLowerCase());
}

// Linux .desktop entries launch us with the %U field code, so a file manager may
// hand us `file:///home/u/notes.md` rather than a path. isMarkdown() would happily
// accept that string while every fs call on it fails, so normalize first. Returns
// '' for a URI we can't convert, which then fails the isMarkdown check. The
// converter is passed in (main hands over url.fileURLToPath) so this file stays free
// of Node built-ins.
export function toLocalPath(arg, fileURLToPath) {
  if (typeof arg !== 'string') return '';
  if (!arg.startsWith('file://')) return arg;
  try {
    return fileURLToPath(arg);
  } catch (_) {
    return '';
  }
}

// The links main opens in the system browser: http(s) and mailto, nothing else.
// Case-sensitive on purpose, as the check it replaced was.
export function isExternalUrl(url) {
  return typeof url === 'string' && /^(https?:|mailto:)/.test(url);
}

// Enforce a Markdown extension on a save path, even if the user typed a bare name.
export function ensureMdExt(filePath) {
  return isMarkdown(filePath) ? filePath : `${filePath}.md`;
}
