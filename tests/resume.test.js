'use strict';

/**
 * resume.test.js — engine/resume.js picks the topics a stopped run did not finish, so "Pick up where I left off"
 * researches exactly those: a topic is finished when its meta.json says complete (the wave's own status does not
 * decide); one set aside (flagged/) or failed (failed/) in this run is not researched again; a draft and a topic never
 * reached are; a finished book from an earlier run does not count, nor, without the run's state, one whose meta.json
 * was written before the run started (earlier the same day); the run's list is the one taken after it started;
 * the pick-up list keeps each request's words and request time line for line, in order, and the next take takes it
 * before her list. Fixed dates, so nothing depends on today. Hermetic: temporary folders only.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pickup = require('../engine/resume');
const requests = require('../engine/requests');
const { makeLibrary, write } = require('./fixtures');

const STARTED = '2026-10-08T23:00:00.000Z';
const BEAT = '2026-10-09T01:30:00.000Z';
const TOPICS = [
  ['Bread ovens at home', ''],
  ['The best garden', ''],
  ['A quiet office', 'A rented flat.'],
  ['Compost heaps in winter', ''],
  ['Rain barrels', 'Two downpipes.'],
  ['Frost dates', 'Zone 6.\n# not a heading\nRaised beds.'],
  ['Sourdough starter care', ''],
];

/** Her folder after a 7-topic run stopped in topic 5: its list taken, its library and its state as the run left them. */
function stoppedRun() {
  const lib = makeLibrary(); // also holds an older finished 2026-09-01-frost-dates, from an earlier run
  const queue = requests.queueFile(lib.home);
  TOPICS.forEach(([topic, framing], i) => requests.add(queue, { topic, framing }, Date.parse('2026-10-08T20:00:00Z') + i * 60000));
  const list = requests.take(queue, Date.parse('2026-10-08T23:00:05Z'));
  requests.add(queue, { topic: 'A newer request' }, Date.parse('2026-10-09T02:00:00Z')); // added after it stopped
  const w = (rel, text) => write(path.join(lib.root, ...rel.split('/')), text);
  const meta = (title) => JSON.stringify({ title, status: 'complete', sourceCount: 3, totalLines: 40 });
  w('2026-10-08-bread-ovens-at-home/00-brief.md', '# Scope Brief: Bread ovens at home\n');
  w('2026-10-08-bread-ovens-at-home/meta.json', meta('Bread ovens at home'));
  w('failed/2026-10-08-the-best-garden.md', '# FAILED — The best garden\n\nBest for what?\n');
  w('flagged/2026-10-08-a-quiet-office/00-brief.md', '# Scope Brief: A quiet office\n');
  w('flagged/2026-10-08-a-quiet-office/_validation-report.md', '# Validation Report\n');
  // The model chose its own folder name for topic 4; its wave still says in-progress, but its meta.json is written.
  w('2026-10-08-winter-compost/00-brief.md', '# Scope Brief: Compost in winter\n');
  w('2026-10-08-winter-compost/meta.json', meta('Compost heaps in winter'));
  // Topic 5 was being written: no meta.json, though the state already calls its wave complete.
  w('2026-10-08-rain-barrels/00-brief.md', '# Scope Brief: Rain barrels\n');
  w('2026-10-08-rain-barrels/01-overview.md', '# Overview\n\nHalf a page.\n');
  const slugOf = (t) => pickup.slugify(t);
  w('marathon-research-state.json', JSON.stringify({
    sessionId: 'research-2026-10-08T18-00', status: 'running', startedAt: STARTED,
    queue: TOPICS.map(([t]) => ({ slug: t === 'Compost heaps in winter' ? 'winter-compost' : slugOf(t), title: t })),
    rotationIndex: 4,
    waves: [
      { waveNumber: 1, slug: '2026-10-08-bread-ovens-at-home', title: 'Bread ovens at home', status: 'complete' },
      { waveNumber: 2, slug: '2026-10-08-the-best-garden', title: 'The best garden', status: 'failed-scope' },
      { waveNumber: 3, slug: '2026-10-08-a-quiet-office', title: 'A quiet office', status: 'failed-validation' },
      { waveNumber: 4, slug: '2026-10-08-winter-compost', title: 'Compost heaps in winter', status: 'in-progress' },
      { waveNumber: 5, slug: '2026-10-08-rain-barrels', title: 'Rain barrels', status: 'complete' },
    ],
  }));
  return { lib, queue, list, opts: { home: lib.home, started: STARTED, list, roots: lib.roots, writeRoot: lib.root } };
}

test('the run\'s list is the first one taken after it started, and not one taken long after it stopped', () => {
  const { lib, list } = stoppedRun();
  const dir = path.dirname(list);
  write(path.join(dir, 'queue-2026-10-08T22-00-00-000Z.md'), '# Research Queue\n\n## An earlier run\n');
  write(path.join(dir, 'queue-2026-10-10T09-00-00-000Z.md'), '# Research Queue\n\n## A later run\n');
  write(path.join(dir, 'notes.md'), 'not a list');
  assert.equal(pickup.takenList(lib.home, STARTED, BEAT), list);
  assert.equal(pickup.takenList(lib.home, '2026-10-10T08:00:00.000Z', '2026-10-10T10:00:00.000Z'), path.join(dir, 'queue-2026-10-10T09-00-00-000Z.md'));
  assert.equal(pickup.takenList(lib.home, '2026-10-11T00:00:00.000Z', null), null, 'nothing taken since');
});

test('finished, flagged and failed topics are done; a draft, a topic never reached and an old book\'s topic are left', () => {
  const { opts, list } = stoppedRun();
  const pick = pickup.leftovers(opts);
  assert.deepEqual(pick, { list: path.basename(list), n: 5, of: 7, left: [4, 5, 6] });
});

test('without the run\'s state, the same topics are found by their slug or their title', () => {
  const { lib, opts } = stoppedRun();
  const state = path.join(lib.root, 'marathon-research-state.json');
  const before = new Date(Date.parse(STARTED) - 60 * 60 * 1000);
  fs.utimesSync(state, before, before); // written before this run started: an earlier run's
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5, 6]);
  fs.rmSync(state);
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5, 6]);
});

test('without the run\'s state, a finished book counts only when its meta.json was written after the run started', () => {
  const { lib, opts } = stoppedRun();
  fs.rmSync(path.join(lib.root, 'marathon-research-state.json'));
  // Topic 7 was asked again: an earlier run finished it at 20:00 the same day, three hours before this run started.
  const folder = path.join(lib.root, '2026-10-08-sourdough-starter-care');
  write(path.join(folder, '00-brief.md'), '# Scope Brief: Sourdough starter care\n');
  write(path.join(folder, 'meta.json'), JSON.stringify({ title: 'Sourdough starter care', status: 'complete' }));
  const earlier = new Date(Date.parse(STARTED) - 3 * 60 * 60 * 1000);
  fs.utimesSync(path.join(folder, 'meta.json'), earlier, earlier);
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5, 6], 'the earlier book is not this run\'s');
  // Written after this run started, the same book is this run's.
  const later = new Date(Date.parse(STARTED) + 60 * 1000);
  fs.utimesSync(path.join(folder, 'meta.json'), later, later);
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5]);
  // The same holds in the marathons/ layout.
  fs.renameSync(folder, path.join(lib.root, 'marathons', '2026-10-08-sourdough-starter-care'));
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5]);
  fs.utimesSync(path.join(lib.root, 'marathons', '2026-10-08-sourdough-starter-care', 'meta.json'), earlier, earlier);
  assert.deepEqual(pickup.leftovers(opts).left, [4, 5, 6]);
});

// In stoppedRun() topic 4's wave still says in-progress and topic 5's says complete: the folders decide both ways.
test('meta.json decides, never the wave: once topic 5 has its meta.json it is finished too', () => {
  const { lib, opts } = stoppedRun();
  write(path.join(lib.root, '2026-10-08-rain-barrels', 'meta.json'), JSON.stringify({ title: 'Rain barrels', status: 'complete' }));
  const pick = pickup.leftovers(opts);
  assert.equal(pick.n, 6, 'it stopped after topic 5 now');
  assert.deepEqual(pick.left, [5, 6]);
});

test('the pick-up list keeps each request line for line, in order; the next take takes it and leaves her list', () => {
  const { lib, queue, list, opts } = stoppedRun();
  const pick = pickup.leftovers(opts);
  const file = pickup.write(lib.home, pick);
  assert.equal(file, requests.resumeFile(lib.home));
  const taken = requests.list(list);
  assert.deepEqual(requests.list(file), [taken[4], taken[5], taken[6]], 'the same words, framing and request times');
  assert.equal(requests.list(file)[1].framing, 'Zone 6.\n# not a heading\nRaised beds.');
  const raw = (f) => requests.split(fs.readFileSync(f, 'utf8')).blocks.map((b) => b.raw.join('').trimEnd());
  assert.deepEqual(raw(file), raw(list).slice(4), 'byte for byte');
  assert.match(fs.readFileSync(file, 'utf8'), /^# Research Queue\n\n## Rain barrels\n<!-- requested 2026-10-08T20:04:00\.000Z -->\nTwo downpipes\.\n/);

  const next = requests.take(queue, Date.parse('2026-10-10T09:00:00Z'));
  assert.deepEqual(requests.list(next).map((r) => r.topic), ['Rain barrels', 'Frost dates', 'Sourdough starter care']);
  assert.deepEqual(requests.list(queue).map((r) => r.topic), ['A newer request'], 'her list waits for the run after');
  assert.deepEqual(requests.list(file), [], 'the pick-up list is left empty, not deleted');
  assert.ok(fs.existsSync(file));
  assert.deepEqual(requests.list(requests.take(queue, Date.parse('2026-10-10T10:00:00Z'))).map((r) => r.topic), ['A newer request']);
});

test('a list that is gone, empty or outside requests/taken gives nothing to pick up', () => {
  const { lib, opts } = stoppedRun();
  assert.equal(pickup.leftovers(Object.assign({}, opts, { list: 'queue-2026-10-08T23-59-59-999Z.md' })), null);
  assert.equal(pickup.leftovers(Object.assign({}, opts, { list: path.join(lib.home, 'requests', 'queue.md') })), null);
  assert.equal(pickup.leftovers(Object.assign({}, opts, { list: '../queue.md' })), null);
  assert.equal(pickup.leftovers(Object.assign({}, opts, { writeRoot: null })), null);
});

test('slugify is marathon-research\'s: lower case, one dash between words, none at the ends, 60 at most', () => {
  assert.equal(pickup.slugify('When can I plant tomatoes outside?'), 'when-can-i-plant-tomatoes-outside');
  assert.equal(pickup.slugify('  --A  B--  '), 'a-b');
  const long = pickup.slugify('word '.repeat(30));
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
});
