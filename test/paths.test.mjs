// Unit tests for the file-path helpers in src/pure.mjs, including the ones main.js
// loads. Run with `npm test` (`node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { samePath, MD_EXTS, isMarkdown, toLocalPath, ensureMdExt, classifyHref } from '../src/pure.mjs';

const BS = '\x5c'; // one backslash, spelled so the Windows paths below stay readable

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

test('MD_EXTS matches the file associations in package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const associated = pkg.build.fileAssociations.map((a) => a.ext).sort();
  assert.deepEqual(associated, [...MD_EXTS].sort());
});

test('every extension in MD_EXTS counts as Markdown and as a Markdown link', () => {
  for (const ext of MD_EXTS) {
    assert.equal(isMarkdown(`notes.${ext}`), true, ext);
    assert.equal(classifyHref(`notes.${ext}`), 'markdown', ext);
  }
});

// isMarkdown stands in for path.extname, so it is checked against the real thing.
const viaExtname = (impl, p) => MD_EXTS.includes(impl.extname(p).slice(1).toLowerCase());

test('isMarkdown agrees with path.extname on edge cases', () => {
  const cases = [
    'a.md', 'A.MD', 'a.Markdown', 'a.mdown', 'a.mkd', 'a.txt', 'a', 'a.', 'a.md.', 'md', '', '/',
    '.md', '..md', 'dir/.md', 'dir/a.md', 'a.md/', 'a.md//', 'a.md.txt', 'archive.tar.md', '.hidden.md',
    ['C:', 'notes', 'a.md'].join(BS),
    ['C:', 'notes', '.md'].join(BS),
    ['C:', 'notes', 'a.md', ''].join(BS)
  ];
  for (const p of cases) {
    assert.equal(isMarkdown(p), viaExtname(path.win32, p), `win32: ${JSON.stringify(p)}`);
    // POSIX does not treat a backslash as a separator, which only matters for a name
    // like `dir\.md`; every other case has to agree with it too.
    if (!p.includes(BS)) assert.equal(isMarkdown(p), viaExtname(path.posix, p), `posix: ${JSON.stringify(p)}`);
  }
});

test('isMarkdown is false for anything that is not a string', () => {
  assert.equal(isMarkdown(null), false);
  assert.equal(isMarkdown(undefined), false);
  assert.equal(isMarkdown(42), false);
  assert.equal(isMarkdown({}), false);
});

test('toLocalPath turns a file: URI into a path with the converter it is given', () => {
  const abs = path.resolve('my notes', 'caf\xe9 & a.md');
  assert.equal(toLocalPath(pathToFileURL(abs).href, fileURLToPath), abs, 'round-trips an absolute path');
  assert.equal(toLocalPath('file:///x/y.md', () => 'converted'), 'converted', 'uses the injected converter');
});

test('toLocalPath leaves plain arguments alone and never calls the converter for them', () => {
  const unused = () => { throw new Error('converter should not run'); };
  assert.equal(toLocalPath('notes/a.md', unused), 'notes/a.md');
  assert.equal(toLocalPath('.', unused), '.');
  assert.equal(toLocalPath('--inspect', unused), '--inspect');
});

test('toLocalPath gives an empty string for what it cannot convert', () => {
  assert.equal(toLocalPath('file:///a%2Fb.md', fileURLToPath), '', 'an encoded slash makes fileURLToPath throw');
  assert.equal(toLocalPath(undefined, fileURLToPath), '');
  assert.equal(toLocalPath(null, fileURLToPath), '');
  assert.equal(toLocalPath(42, fileURLToPath), '');
});

test('ensureMdExt appends .md unless the path already names a Markdown file', () => {
  assert.equal(ensureMdExt('notes'), 'notes.md');
  assert.equal(ensureMdExt('notes.txt'), 'notes.txt.md');
  assert.equal(ensureMdExt('notes.md'), 'notes.md');
  assert.equal(ensureMdExt('Notes.MD'), 'Notes.MD', 'extension case is ignored');
  assert.equal(ensureMdExt('notes.markdown'), 'notes.markdown');
  assert.equal(ensureMdExt('.md'), '.md.md', 'a bare dot-extension is a name, not an extension');
});
