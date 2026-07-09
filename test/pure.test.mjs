// Unit tests for the pure helpers the renderer relies on. Run with `npm test`
// (`node --test`). No DOM or Electron needed — this is the logic that is hard to
// eyeball: proportional scroll mapping, size clamps, and shortcut rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proportional, clampTocWidth, clampSplitFraction, comboToHtml, toEol } from '../src/pure.mjs';

test('proportional maps scroll fraction onto the other pane', () => {
  const src = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  const dst = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  assert.equal(proportional({ ...src, scrollTop: 0 }, dst), 0, 'top maps to top');
  assert.equal(proportional({ ...src, scrollTop: 600 }, dst), 1600, 'bottom maps to bottom');
  assert.equal(proportional({ ...src, scrollTop: 300 }, dst), 800, 'halfway maps proportionally');
});

test('proportional returns null when a pane cannot scroll', () => {
  const scrollable = { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 };
  assert.equal(proportional({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }, scrollable), null, 'source not scrollable');
  assert.equal(proportional(scrollable, { scrollTop: 0, scrollHeight: 400, clientHeight: 400 }), null, 'dest not scrollable');
});

test('clampTocWidth enforces min 140 and the given max, rounded', () => {
  assert.equal(clampTocWidth(50, 600), 140, 'clamps up to min');
  assert.equal(clampTocWidth(800, 600), 600, 'clamps down to max');
  assert.equal(clampTocWidth(260.4, 600), 260, 'rounds within range');
});

test('clampSplitFraction keeps the split between 0.15 and 0.85', () => {
  assert.equal(clampSplitFraction(0.05), 0.15);
  assert.equal(clampSplitFraction(0.95), 0.85);
  assert.equal(clampSplitFraction(0.5), 0.5);
});

test('comboToHtml substitutes the modifier and wraps keys in <kbd>', () => {
  assert.equal(comboToHtml('MOD+N', 'Ctrl'), '<kbd>Ctrl</kbd>+<kbd>N</kbd>');
  assert.equal(comboToHtml('MOD+Shift+S', '⌘'), '<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>');
  assert.equal(
    comboToHtml('MOD+PgDn / MOD+PgUp', 'Ctrl'),
    '<kbd>Ctrl</kbd>+<kbd>PgDn</kbd> / <kbd>Ctrl</kbd>+<kbd>PgUp</kbd>',
    'splits alternatives on " / "'
  );
});

test('toEol converts to CRLF only when requested', () => {
  assert.equal(toEol('a\nb\nc', '\r\n'), 'a\r\nb\r\nc', 'LF -> CRLF');
  assert.equal(toEol('a\nb\nc', '\n'), 'a\nb\nc', 'LF stays LF');
});
