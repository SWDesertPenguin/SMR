// Unit tests for the document-text helpers in src/pure.mjs: heading ids, line
// endings and the byte-order mark. Run with `npm test` (`node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEol, makeSlugger, normalizeEol, detectEol, stripBom, withBom } from '../src/pure.mjs';

test('toEol converts to CRLF only when requested', () => {
  assert.equal(toEol('a\nb\nc', '\r\n'), 'a\r\nb\r\nc', 'LF -> CRLF');
  assert.equal(toEol('a\nb\nc', '\n'), 'a\nb\nc', 'LF stays LF');
});

test('makeSlugger prefixes ids and keeps non-ASCII letters', () => {
  const slug = makeSlugger();
  assert.equal(slug('Café'), 'md-café');
  assert.equal(slug('日本語'), 'md-日本語');
  assert.equal(slug('Hello, World!'), 'md-hello-world');
  assert.equal(slug('Body'), 'md-body', 'cannot collide with #body');
});

test('makeSlugger de-duplicates within one slugger and resets on a new one', () => {
  const slug = makeSlugger();
  assert.equal(slug('Foo'), 'md-foo');
  assert.equal(slug('Foo'), 'md-foo-1');
  assert.equal(slug('Foo'), 'md-foo-2');
  assert.equal(makeSlugger()('Foo'), 'md-foo', 'fresh slugger starts over');
});

test('makeSlugger falls back to md-section for empty results', () => {
  const slug = makeSlugger();
  assert.equal(slug(''), 'md-section');
  assert.equal(slug('!!!'), 'md-section-1');
});

test('toEol is idempotent on text that is already CRLF', () => {
  assert.equal(toEol('a\r\nb\r\nc', '\r\n'), 'a\r\nb\r\nc', 'CRLF is not doubled');
  assert.equal(toEol('a\r\nb\nc', '\r\n'), 'a\r\nb\r\nc', 'mixed input comes out uniform');
  assert.equal(toEol(toEol('a\nb', '\r\n'), '\r\n'), 'a\r\nb', 'applying twice equals applying once');
  assert.equal(toEol('', '\r\n'), '', 'empty input');
});

test('normalizeEol collapses CRLF and lone CR to LF', () => {
  assert.equal(normalizeEol('a\r\nb\r\nc'), 'a\nb\nc', 'CRLF');
  assert.equal(normalizeEol('a\rb\rc'), 'a\nb\nc', 'lone CR');
  assert.equal(normalizeEol('a\r\nb\rc\nd'), 'a\nb\nc\nd', 'mixed');
  assert.equal(normalizeEol('a\n\rb'), 'a\n\nb', 'LF then CR stays two breaks');
  assert.equal(normalizeEol('a\nb'), 'a\nb', 'LF is untouched');
  assert.equal(normalizeEol(''), '', 'empty input');
});

test('detectEol reports CRLF only when the text contains it', () => {
  assert.equal(detectEol('a\r\nb\r\n'), '\r\n', 'CRLF file');
  assert.equal(detectEol('a\nb\n'), '\n', 'LF file');
  assert.equal(detectEol('a\rb\r'), '\n', 'lone CR is written back as LF');
  assert.equal(detectEol('a\nb\r\nc'), '\r\n', 'mixed with any CRLF counts as CRLF');
  assert.equal(detectEol(''), '\n', 'empty input defaults to LF');
});

test('stripBom splits a leading BOM off and reports it', () => {
  assert.deepEqual(stripBom('\uFEFF# Title\n'), { text: '# Title\n', bom: true });
  assert.deepEqual(stripBom('# Title\n'), { text: '# Title\n', bom: false });
  assert.deepEqual(stripBom(''), { text: '', bom: false }, 'empty input');
  assert.deepEqual(stripBom('a\uFEFFb'), { text: 'a\uFEFFb', bom: false }, 'only a leading BOM counts');
  assert.deepEqual(stripBom('\uFEFF\uFEFFx'), { text: '\uFEFFx', bom: true }, 'strips exactly one');
});

test('withBom restores the BOM only when it was present', () => {
  assert.equal(withBom('# Title\n', true), '\uFEFF# Title\n');
  assert.equal(withBom('# Title\n', false), '# Title\n');
  assert.equal(withBom('\uFEFF# Title\n', true), '\uFEFF# Title\n', 'does not double an existing BOM');
  assert.equal(withBom('', true), '\uFEFF', 'empty text still gets the BOM');
});

test('stripBom then withBom round-trips', () => {
  for (const raw of ['\uFEFF# Title\n', '# Title\n', '']) {
    const { text, bom } = stripBom(raw);
    assert.equal(withBom(text, bom), raw);
  }
});
