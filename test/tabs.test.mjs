// Unit tests for the tab helpers in src/pure.mjs. Run with `npm test`
// (`node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedName, cycleIndex, neighborAfterClose } from '../src/pure.mjs';

test('suggestedName adds .md only when the name does not already end in it', () => {
  assert.equal(suggestedName('Untitled-1'), 'Untitled-1.md');
  assert.equal(suggestedName('notes.md'), 'notes.md');
  assert.equal(suggestedName('notes.markdown'), 'notes.markdown.md', 'only .md counts');
  assert.equal(suggestedName('NOTES.MD'), 'NOTES.MD.md', 'the check is case-sensitive');
});

test('cycleIndex steps forward and back with wrap-around', () => {
  assert.equal(cycleIndex(3, 0, 1), 1);
  assert.equal(cycleIndex(3, 2, 1), 0, 'forward from the last tab wraps to the first');
  assert.equal(cycleIndex(3, 0, -1), 2, 'back from the first tab wraps to the last');
  assert.equal(cycleIndex(3, 1, -1), 0);
  assert.equal(cycleIndex(2, 0, 1), 1);
  assert.equal(cycleIndex(2, 1, 1), 0);
});

test('cycleIndex with no active tab (-1) is plain arithmetic', () => {
  assert.equal(cycleIndex(3, -1, 1), 0, 'forward lands on the first tab');
  assert.equal(cycleIndex(3, -1, -1), 1);
});

test('neighborAfterClose picks the tab that slid into the closed slot', () => {
  // length counts the tabs that remain, so closing b from [a, b, c] is length 2, index 1.
  assert.equal(neighborAfterClose(2, 1), 1, 'closing a middle tab shows the one after it (c)');
  assert.equal(neighborAfterClose(2, 0), 0, 'closing the first tab shows the new first');
});

test('neighborAfterClose falls back to the last tab when the closed one was last', () => {
  assert.equal(neighborAfterClose(2, 2), 1, 'closing c from [a, b, c] shows b');
  assert.equal(neighborAfterClose(1, 1), 0);
  assert.equal(neighborAfterClose(3, -1), 2, 'an index that is gone also lands on the last tab');
});

test('neighborAfterClose returns -1 when no tabs are left', () => {
  assert.equal(neighborAfterClose(0, 0), -1);
  assert.equal(neighborAfterClose(0, -1), -1);
});
