// Unit tests for how the preview classifies image sources and link targets
// (src/pure.mjs). Run with `npm test` (`node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImageSrc, smrDocUrl, classifyHref } from '../src/pure.mjs';

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
