// Unit tests for the pure helpers the renderer relies on. Run with `npm test`
// (`node --test`). No DOM or Electron needed — this is the logic that is hard to
// eyeball: proportional scroll mapping, size clamps, and shortcut rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proportional, clampTocWidth, clampSplitFraction, comboToHtml, toEol, makeSlugger, normalizeEol, detectEol, samePath, stripBom, withBom, classifyImageSrc, smrDocUrl, classifyHref, validTheme, resolveTheme, validLayout } from '../src/pure.mjs';

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

test('samePath ignores case on win32 only', () => {
  assert.equal(samePath('C:\\Notes\\A.md', 'c:\\notes\\a.md', 'win32'), true, 'win32 is case-insensitive');
  assert.equal(samePath('C:\\Notes\\A.md', 'C:\\Notes\\B.md', 'win32'), false, 'different files');
  assert.equal(samePath('/home/u/A.md', '/home/u/a.md', 'linux'), false, 'linux is case-sensitive');
  assert.equal(samePath('/Users/u/A.md', '/Users/u/a.md', 'darwin'), false, 'darwin compares exactly');
  assert.equal(samePath('/home/u/a.md', '/home/u/a.md', 'linux'), true, 'identical paths');
});

test('samePath is false when either side is not a string', () => {
  assert.equal(samePath(null, 'a.md', 'win32'), false);
  assert.equal(samePath('a.md', undefined, 'linux'), false);
  assert.equal(samePath(null, null, 'win32'), false, 'two untitled tabs are not the same file');
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

const BS = '\x5c'; // one backslash, spelled so the Windows paths below stay readable

test('classifyImageSrc separates data, remote, local and empty srcs', () => {
  assert.equal(classifyImageSrc('img/a.png'), 'local');
  assert.equal(classifyImageSrc('../up.png'), 'local');
  assert.equal(classifyImageSrc('/abs/a.png'), 'local');
  assert.equal(classifyImageSrc('data:image/png;base64,AAAA'), 'data');
  assert.equal(classifyImageSrc('https://example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('http://example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('//example.com/x.png'), 'remote', 'protocol-relative is remote');
  assert.equal(classifyImageSrc(''), 'empty');
  assert.equal(classifyImageSrc(null), 'empty');
});

test('classifyImageSrc sees through case, whitespace and backslash tricks', () => {
  assert.equal(classifyImageSrc('HTTPS://example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('  https://example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('ht\ttps://example.com/x.png'), 'remote', 'a tab inside the scheme is dropped by URL parsing');
  assert.equal(classifyImageSrc([BS, BS, 'host', BS, 'share', BS, 'x.png'].join('')), 'remote', 'UNC-style paths are treated as remote');
  assert.equal(classifyImageSrc(' DATA:image/png;base64,AAAA'), 'data');
});

test('classifyImageSrc treats https: without slashes as remote', () => {
  assert.equal(classifyImageSrc('https:example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('https:/example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('http:example.com/x.png'), 'remote');
  assert.equal(classifyImageSrc('httpsfoo/x.png'), 'local', 'a folder that merely starts with the letters is still a path');
});

test('smrDocUrl encodes the document and the raw src as separate query values', () => {
  const doc = ['C:', 'docs', 'a b.md'].join(BS);
  const url = new URL(smrDocUrl(doc, 'img/my%20pic.png?x=1#f'));
  assert.equal(url.protocol, 'smr-doc:');
  assert.equal(url.hostname, 'local');
  assert.equal(url.searchParams.get('doc'), doc);
  assert.equal(url.searchParams.get('rel'), 'img/my%20pic.png?x=1#f', 'the src is kept as written, escapes included');
});

test('classifyHref routes anchors, external links, Markdown files and the rest', () => {
  assert.equal(classifyHref('#second'), 'anchor');
  assert.equal(classifyHref('https://example.com/a.md'), 'external', 'a remote .md is still external');
  assert.equal(classifyHref('http://example.com'), 'external');
  assert.equal(classifyHref('mailto:a@example.com'), 'external');
  assert.equal(classifyHref('other.md'), 'markdown');
  assert.equal(classifyHref('../notes/Other.MD'), 'markdown');
  assert.equal(classifyHref('sub/my%20doc.markdown#sec'), 'markdown', 'query and fragment are ignored');
  assert.equal(classifyHref('a.mdown?x=1'), 'markdown');
  assert.equal(classifyHref('a.mkd'), 'markdown');
  assert.equal(classifyHref(['C:', 'notes', 'a.md'].join(BS)), 'markdown', 'a drive letter is not a URL scheme');
  assert.equal(classifyHref('photo.png'), 'other');
  assert.equal(classifyHref('docs/'), 'other');
  assert.equal(classifyHref('javascript:alert(1)'), 'other');
  assert.equal(classifyHref('file:///etc/a.md'), 'other', 'other schemes are never opened as relative files');
  assert.equal(classifyHref(''), 'other');
  assert.equal(classifyHref(null), 'other');
});

test('validTheme accepts only light and dark', () => {
  assert.equal(validTheme('light'), 'light');
  assert.equal(validTheme('dark'), 'dark');
  assert.equal(validTheme('Dark'), null, 'case matters');
  assert.equal(validTheme('solarized'), null);
  assert.equal(validTheme(''), null);
  assert.equal(validTheme(undefined), null);
  assert.equal(validTheme({}), null);
});

test('resolveTheme prefers settings, then localStorage (flagged to migrate), then the OS', () => {
  assert.deepEqual(resolveTheme('dark', 'light', false), { theme: 'dark', migrate: false });
  assert.deepEqual(resolveTheme(undefined, 'dark', false), { theme: 'dark', migrate: true });
  assert.deepEqual(resolveTheme(undefined, undefined, true), { theme: 'dark', migrate: false });
  assert.deepEqual(resolveTheme(undefined, undefined, false), { theme: 'light', migrate: false });
});

test('resolveTheme skips invalid stored values instead of trusting them', () => {
  assert.deepEqual(resolveTheme('blue', 'dark', false), { theme: 'dark', migrate: true }, 'bad settings falls through to localStorage');
  assert.deepEqual(resolveTheme('blue', 'red', true), { theme: 'dark', migrate: false }, 'both bad falls through to the OS');
  assert.deepEqual(resolveTheme(null, null, false), { theme: 'light', migrate: false });
});

test('validLayout keeps known layouts and falls back otherwise', () => {
  const layouts = ['split', 'preview', 'editor'];
  assert.equal(validLayout('preview', layouts, 'split'), 'preview');
  assert.equal(validLayout('grid', layouts, 'split'), 'split');
  assert.equal(validLayout(null, layouts, 'split'), 'split');
  assert.equal(validLayout('toString', layouts, 'split'), 'split', 'inherited property names are not layouts');
});
