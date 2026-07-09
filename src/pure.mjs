// Pure, DOM-free helpers shared by the renderer (src/renderer.js) and the unit
// tests (test/pure.test.mjs). Nothing here may touch the DOM, window, or IPC —
// that keeps it importable in plain Node so the logic can be tested in CI.

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

// Render a shortcut combo like "MOD+Shift+S" into <kbd> chips, substituting the
// platform modifier (⌘ or Ctrl) for MOD and splitting on '+' and ' / '.
export function comboToHtml(combo, mod) {
  return combo
    .replaceAll('MOD', mod)
    .split(' / ')
    .map((part) => part.split('+').map((k) => `<kbd>${k}</kbd>`).join('+'))
    .join(' / ');
}

// Apply the target end-of-line style to LF-normalized text before writing.
export function toEol(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}
