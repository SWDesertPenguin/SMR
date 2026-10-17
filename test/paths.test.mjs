// Unit tests for the file-path helpers in src/pure.mjs. Run with `npm test`
// (`node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samePath } from '../src/pure.mjs';

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
