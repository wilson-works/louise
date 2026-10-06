// tests/seen.test.js: engine/seen.js, the books the person has opened, so a newly finished one waits to be shown.
// Contract under test: the first read starts the list from every book on the shelves (the library she already had
// never waits); after that a finished book that is not an example and not on the list waits, newest first; failed,
// flagged and in-progress books never wait, nor do the examples; marking a book seen takes it off; a book that is not
// on the shelves is a 404; adding or reordering roots does not make old books new. Hermetic: a temporary folder only.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const seen = require('../engine/seen');
const { tmpdir } = require('./fixtures');

const A = path.join(tmpdir('seen-a'), 'research');
const B = path.join(tmpdir('seen-b'), 'research');
const EX = path.join(tmpdir('seen-ex'), 'examples');

// An index in the shape engine/library.js gives: book ids start with their root's number.
function index(roots, books) {
  const all = books.map((b) => Object.assign({ status: 'finished', kind: 'topic', example: Boolean(roots[Number(b.id.split('-')[0])].example) }, b));
  return { roots, books: all, byId: new Map(all.map((b) => [b.id, b])) };
}

test('the first read counts every book on the shelves as seen, and writes the list', () => {
  const file = seen.seenFile(tmpdir('seen-home'));
  const ix = index([{ path: A }], [{ id: '0-t-2026-01-01-old', title: 'Old', date: '2026-01-01' }, { id: '0-t-2026-02-01-older', title: 'Older', date: '2026-02-01' }]);
  assert.deepEqual(seen.unseen(file, ix), []);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.seen.length, 2);
  assert.ok(saved.since);
});

test('a finished book that arrives later waits, newest first; failed, flagged, in-progress and examples never wait', () => {
  const file = seen.seenFile(tmpdir('seen-home'));
  const roots = [{ path: A }, { path: EX, example: true }];
  seen.unseen(file, index(roots, [{ id: '0-t-2026-01-01-old', title: 'Old', date: '2026-01-01' }]));
  const later = index(roots, [
    { id: '0-t-2026-01-01-old', title: 'Old', date: '2026-01-01' },
    { id: '0-t-2026-10-01-new', title: 'New', date: '2026-10-01' },
    { id: '0-t-2026-10-04-newer', title: 'Newer', date: '2026-10-04' },
    { id: '0-r-run-1', title: 'The run', date: '2026-10-04', kind: 'run-summary' },
    { id: '0-f-2026-10-04-vague', title: 'Vague', date: '2026-10-04', status: 'failed' },
    { id: '0-x-2026-10-04-unsourced', title: 'Unsourced', date: '2026-10-04', status: 'flagged' },
    { id: '0-t-2026-10-05-going', title: 'Going', date: '2026-10-05', status: 'in-progress' },
    { id: '1-t-2026-10-05-example', title: 'Example', date: '2026-10-05' },
  ]);
  assert.deepEqual(seen.unseen(file, later), [
    { id: '0-t-2026-10-04-newer', title: 'Newer' }, { id: '0-r-run-1', title: 'The run' }, { id: '0-t-2026-10-01-new', title: 'New' },
  ]);
});

test('marking a book seen takes it off the list and keeps it off; a book not on the shelves is a 404', () => {
  const file = seen.seenFile(tmpdir('seen-home'));
  const roots = [{ path: A }];
  seen.unseen(file, index(roots, []));
  const ix = index(roots, [{ id: '0-t-2026-10-01-new', title: 'New', date: '2026-10-01' }]);
  assert.equal(seen.unseen(file, ix).length, 1);
  const r = seen.mark(file, ix, '0-t-2026-10-01-new');
  assert.deepEqual(r.unseen, []);
  assert.deepEqual(seen.unseen(file, ix), []);
  assert.equal(seen.mark(file, ix, '0-t-2026-10-01-new').seen, r.seen, 'marking twice adds nothing');
  for (const bad of ['0-t-nope', '../state/seen.json', '', null, 42]) {
    assert.throws(() => seen.mark(file, ix, bad), (e) => e.status === 404, String(bad));
  }
});

test('adding a root in front does not make the books already seen look new', () => {
  const file = seen.seenFile(tmpdir('seen-home'));
  seen.unseen(file, index([{ path: A }], [{ id: '0-t-2026-01-01-old', title: 'Old', date: '2026-01-01' }]));
  const moved = index([{ path: B }, { path: A }], [{ id: '1-t-2026-01-01-old', title: 'Old', date: '2026-01-01' }]);
  assert.deepEqual(seen.unseen(file, moved), []);
});

test('an unreadable list is started again from the shelves, never a flood of every book', () => {
  const file = seen.seenFile(tmpdir('seen-home'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const ix = index([{ path: A }], [{ id: '0-t-2026-01-01-old', title: 'Old', date: '2026-01-01' }]);
  assert.deepEqual(seen.unseen(file, ix), []);
});
