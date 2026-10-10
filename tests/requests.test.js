'use strict';

/**
 * requests.test.js — engine/requests.js keeps Louise's list in marathon-research's queue format ("# Research Queue",
 * one "## " heading per topic, framing under it); framing can never start a new topic; a topic is checked; the list
 * has a limit; take moves the list aside for a run and leaves an empty one, never deleting anything; remove takes one
 * request off by its topic and request time and leaves every other line as written; a waiting pick-up list
 * (requests/resume.md) is taken before her list.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const requests = require('../engine/requests');
const { tmpdir } = require('./fixtures');

test('requests go on the list in the queue format marathon-research reads', () => {
  const file = requests.queueFile(tmpdir('req'));
  assert.deepEqual(requests.list(file), []);
  assert.deepEqual(requests.add(file, { topic: 'When can I plant tomatoes outside?', framing: 'Raised beds.\n## not a topic\n# nor this' }, Date.parse('2026-10-05T19:40:00Z')), { queued: 1 });
  assert.deepEqual(requests.add(file, { topic: '  Repotting   a fig  ' }), { queued: 2 });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# Research Queue\n/);
  assert.equal((text.match(/^## /gm) || []).length, 2, 'framing never starts a topic');
  const list = requests.list(file);
  assert.equal(list[0].topic, 'When can I plant tomatoes outside?');
  assert.equal(list[0].framing, 'Raised beds.\n## not a topic\n# nor this', 'framing reads back as it was written');
  assert.equal(list[0].at, '2026-10-05T19:40:00.000Z');
  assert.equal(list[1].topic, 'Repotting a fig');
  assert.equal(list[1].framing, '');
});

test('a topic is checked, and the list has a limit', () => {
  const file = requests.queueFile(tmpdir('req'));
  for (const bad of [undefined, 42, '', 'ab', '#', 'x'.repeat(201)]) {
    assert.throws(() => requests.add(file, { topic: bad }), (e) => e.status === 400, String(bad));
  }
  assert.throws(() => requests.add(file, { topic: 'Fine topic', framing: 'x'.repeat(2001) }), (e) => e.status === 400);
  assert.throws(() => requests.add(file, { topic: 'Fine topic', framing: { a: 1 } }), (e) => e.status === 400);
  assert.equal(requests.add(file, { topic: '## Heading marks are dropped' }).queued, 1);
  assert.equal(requests.list(file)[0].topic, 'Heading marks are dropped');
  for (let i = 1; i < requests.LIST_MAX; i += 1) requests.add(file, { topic: `Topic number ${i}` });
  assert.throws(() => requests.add(file, { topic: 'One too many' }), /list is full/);
});

test('take moves the list aside for a run and leaves an empty list', () => {
  const file = requests.queueFile(tmpdir('req'));
  assert.equal(requests.take(file), null, 'nothing to take');
  requests.add(file, { topic: 'Frost dates for raised beds' });
  const before = fs.readFileSync(file, 'utf8');
  const taken = requests.take(file, Date.parse('2026-10-05T20:00:00Z'));
  assert.equal(path.dirname(taken), path.join(path.dirname(file), 'taken'));
  assert.equal(fs.readFileSync(taken, 'utf8'), before);
  assert.deepEqual(requests.list(file), []);
  assert.ok(fs.existsSync(file), 'the list file stays');
  requests.add(file, { topic: 'Another one' });
  assert.notEqual(requests.take(file, Date.parse('2026-10-05T20:00:00Z')), taken, 'a second take the same second gets its own file');
});

test('remove takes one request off by its topic and time, and leaves every other line exactly as written', () => {
  const file = requests.queueFile(tmpdir('req'));
  requests.add(file, { topic: 'Frost dates', framing: 'Zone 6.\n# kept as written' }, Date.parse('2026-10-05T19:40:00Z'));
  requests.add(file, { topic: 'No question just you stalled out' }, Date.parse('2026-10-05T19:41:00Z'));
  requests.add(file, { topic: 'Repotting a fig' }, Date.parse('2026-10-05T19:42:00Z'));
  requests.add(file, { topic: 'No question just you stalled out' }, Date.parse('2026-10-05T19:43:00Z'));
  const before = requests.split(fs.readFileSync(file, 'utf8')).blocks.map((b) => b.raw.join(''));
  const at = '2026-10-05T19:41:00.000Z';
  assert.deepEqual(requests.remove(file, { topic: 'No question just you stalled out', at }), { removed: true, queued: 3 });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# Research Queue\n\n## Frost dates\n/);
  assert.deepEqual(requests.split(text).blocks.map((b) => b.raw.join('')), [before[0], before[2], before[3]], 'the others, byte for byte');
  assert.deepEqual(requests.list(file).map((r) => [r.topic, r.at]), [
    ['Frost dates', '2026-10-05T19:40:00.000Z'], ['Repotting a fig', '2026-10-05T19:42:00.000Z'], ['No question just you stalled out', '2026-10-05T19:43:00.000Z'],
  ], 'only the one with that time went; the same words asked later stay');

  assert.throws(() => requests.remove(file, { topic: 'No question just you stalled out', at }), (e) => e.status === 404, 'gone already');
  assert.throws(() => requests.remove(file, { topic: 'Frost dates', at: '2026-10-05T19:40:00Z' }), (e) => e.status === 404, 'the time must match as listed');
  for (const bad of [{}, { topic: 42 }, { topic: '' }, { topic: 'Frost dates', at: 7 }]) {
    assert.throws(() => requests.remove(file, bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  requests.remove(file, { topic: 'Frost dates', at: '2026-10-05T19:40:00.000Z' });
  requests.remove(file, { topic: 'Repotting a fig', at: '2026-10-05T19:42:00.000Z' });
  assert.deepEqual(requests.remove(file, { topic: 'No question just you stalled out', at: '2026-10-05T19:43:00.000Z' }), { removed: true, queued: 0 });
  assert.equal(fs.readFileSync(file, 'utf8'), '# Research Queue\n', 'an empty list, never a deleted file');
  requests.add(file, { topic: 'A fresh one' });
  assert.deepEqual(requests.list(file).map((r) => r.topic), ['A fresh one']);
});

test('a waiting pick-up list (requests/resume.md) is taken before her list, which waits for the run after', () => {
  const file = requests.queueFile(tmpdir('req'));
  requests.add(file, { topic: 'A newer request' });
  fs.writeFileSync(requests.resumeFile(path.dirname(path.dirname(file))), '# Research Queue\n\n## Rain barrels\n<!-- requested 2026-10-08T20:01:00.000Z -->\nTwo downpipes.\n');
  const first = requests.take(file, Date.parse('2026-10-10T09:00:00Z'));
  assert.deepEqual(requests.list(first), [{ topic: 'Rain barrels', framing: 'Two downpipes.', at: '2026-10-08T20:01:00.000Z' }]);
  assert.deepEqual(requests.list(file).map((r) => r.topic), ['A newer request']);
  const second = requests.take(file, Date.parse('2026-10-10T10:00:00Z'));
  assert.deepEqual(requests.list(second).map((r) => r.topic), ['A newer request']);
  assert.equal(requests.take(file), null, 'both empty now');
});
