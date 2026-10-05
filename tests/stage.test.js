'use strict';

/**
 * stage.test.js — engine/stage.js: setting each stage and reading it back; a step is n/of; "since" holds while the
 * stage and topic stay the same; a fetch lasts about six seconds and then falls back to what it was; a stage set more
 * than two hours ago reads idle unless marathon-research says its run is going; a wave in progress, started after
 * Louise last set her stage, reads researching; a dead session's wave is not believed for ever. Times are passed in,
 * so nothing here waits.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const stage = require('../engine/stage');
const { tmpdir } = require('./fixtures');

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-05T19:00:00.000Z');

function setup(marathon) {
  const home = tmpdir('stage');
  const file = stage.stageFile(home);
  const root = path.join(home, 'library');
  fs.mkdirSync(root, { recursive: true });
  const roots = [{ label: 'L', path: root, council: 'council', state: path.join(root, 'marathon-research-state.json') }];
  if (marathon) fs.writeFileSync(roots[0].state, JSON.stringify(marathon));
  return { file, roots };
}

test('each stage is set and read back, with its topic, run, step and note', () => {
  const { file, roots } = setup();
  for (const s of ['researching', 'council', 'distill', 'shelving']) {
    stage.set(file, s, { topic: 'Frost dates', run: 'research-1', step: '2/5', note: 'Reading' }, T0);
    assert.deepEqual(stage.current(file, roots, T0 + 1000), {
      stage: s, topic: 'Frost dates', run: 'research-1', step: { n: 2, of: 5 }, since: new Date(T0).toISOString(), note: 'Reading',
    });
  }
  stage.set(file, 'idle', { topic: 'ignored' }, T0);
  const idle = stage.current(file, roots, T0);
  assert.equal(idle.stage, 'idle');
  assert.equal(idle.topic, null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).stage, 'idle', 'it is a plain JSON file');
});

test('a bad stage or step is refused in plain words; "since" holds while nothing changes', () => {
  const { file } = setup();
  assert.throws(() => stage.set(file, 'dancing'), /not one of Louise's stages/);
  assert.throws(() => stage.set(file, 'researching', { step: '7/5' }), /does not add up/);
  assert.throws(() => stage.set(file, 'researching', { step: 'two' }), /should look like 2\/5/);
  assert.deepEqual(stage.parseStep('3 of 4'), { n: 3, of: 4 });
  const a = stage.set(file, 'researching', { topic: 'A' }, T0);
  const b = stage.set(file, 'researching', { topic: 'A', note: 'later' }, T0 + 60000);
  assert.equal(b.since, a.since);
  assert.notEqual(b.updated, a.updated);
  const c = stage.set(file, 'researching', { topic: 'B' }, T0 + 120000);
  assert.equal(c.since, new Date(T0 + 120000).toISOString(), 'a new topic starts a new "since"');
});

test('a fetch lasts FETCH_MS, then the stage is what it was before', () => {
  const { file, roots } = setup();
  stage.set(file, 'distill', { topic: 'Sourdough' }, T0);
  stage.startFetch(file, { book: '0-t-x', title: 'Frost dates' }, T0 + 1000);
  const during = stage.current(file, roots, T0 + 1000 + stage.FETCH_MS - 1);
  assert.equal(during.stage, 'fetching');
  assert.equal(during.book, '0-t-x');
  assert.equal(during.topic, 'Frost dates');
  const after = stage.current(file, roots, T0 + 1000 + stage.FETCH_MS + 1);
  assert.equal(after.stage, 'distill');
  assert.equal(after.topic, 'Sourdough');
  // A second fetch during the first still falls back to the stage before both.
  stage.startFetch(file, { book: 'a' }, T0 + 2000);
  stage.startFetch(file, { book: 'b' }, T0 + 3000);
  assert.equal(stage.current(file, roots, T0 + 3000 + stage.FETCH_MS + 1).stage, 'distill');
  // "set fetching" from the CLI is a fetch too.
  stage.set(file, 'fetching', { topic: 'E-bikes' }, T0 + 5000);
  assert.equal(stage.current(file, roots, T0 + 5001).stage, 'fetching');
});

test('two hours with no change reads idle, unless marathon-research says its run is going', () => {
  const { file, roots } = setup();
  stage.set(file, 'council', {}, T0);
  assert.equal(stage.current(file, roots, T0 + stage.STALE_MS - 1).stage, 'council');
  assert.equal(stage.current(file, roots, T0 + stage.STALE_MS + 1).stage, 'idle');
  assert.equal(stage.current(path.join(path.dirname(file), 'none.json'), roots, T0).stage, 'idle', 'no stage file reads idle');

  const going = setup({ sessionId: 'research-2', status: 'running', startedAt: new Date(T0).toISOString(), hoursCap: 8,
    queue: [{ title: 'A' }, { title: 'B' }], rotationIndex: 1, waves: [{ waveNumber: 1, title: 'A', status: 'complete' }] });
  stage.set(going.file, 'council', {}, T0);
  const s = stage.current(going.file, going.roots, T0 + 3 * H);
  assert.equal(s.stage, 'researching');
  assert.equal(s.topic, 'B', 'between waves, the next topic on the queue');
  assert.equal(s.run, 'research-2');
});

test('a wave in progress newer than her stage reads researching; an old one from a dead session does not', () => {
  const wave = (startedAt) => ({ sessionId: 'research-3', status: 'running', startedAt: new Date(T0).toISOString(), hoursCap: 8,
    queue: [{ title: 'A' }, { title: 'B' }], rotationIndex: 1,
    waves: [{ waveNumber: 2, title: 'B', status: 'in-progress', startedAt: new Date(startedAt).toISOString() }] });

  const fresh = setup(wave(T0 + 10 * 60000));
  stage.set(fresh.file, 'idle', {}, T0);
  assert.deepEqual(stage.current(fresh.file, fresh.roots, T0 + 11 * 60000), {
    stage: 'researching', topic: 'B', run: 'research-3', step: { n: 2, of: 2 }, since: new Date(T0 + 10 * 60000).toISOString(), note: 'Wave 2 of 2',
  });
  // With no stage file at all, the wave still shows.
  const none = setup(wave(T0));
  assert.equal(stage.current(none.file, none.roots, T0 + 60000).stage, 'researching');

  // She set her stage after the wave began: hers wins.
  stage.set(fresh.file, 'council', {}, T0 + 20 * 60000);
  assert.equal(stage.current(fresh.file, fresh.roots, T0 + 21 * 60000).stage, 'council');

  // A session that died mid-wave a day ago is not believed.
  const dead = setup(Object.assign(wave(T0 - 24 * H), { startedAt: new Date(T0 - 24 * H).toISOString() }));
  assert.equal(stage.current(dead.file, dead.roots, T0).stage, 'idle');
});
