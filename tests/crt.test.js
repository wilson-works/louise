// tests/crt.test.js: the screen strip under her desk (dashboard/public/crt.js).
// Contract under test: READY only at idle; in every other stage the strip is live, even with no topic yet (the owner
// saw READY under "Looking it up" while a run was getting ready); the head is the topic, else the note, else her name
// for the stage; the note is not said twice; a step is shown only when it adds up; the minutes come from since.
// Hermetic: no files, no network, no ports.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crt = require('../dashboard/public/crt.js');

const NAMES = { idle: 'Ready for a question', researching: 'Looking it up', council: 'The reading room', distill: 'The red pen', shelving: 'Shelving' };
const NOW = Date.parse('2026-10-05T20:10:00Z');

test('at idle the strip is READY, whatever else the stage file says', () => {
  for (const s of [{ stage: 'idle' }, { stage: 'idle', note: 'Stopped from her dashboard.' }, {}, null, undefined]) {
    assert.equal(crt.lines(s, NAMES, NOW).ready, true, JSON.stringify(s));
  }
});

test('a run that is getting ready, with no topic yet, is live: > Getting ready', () => {
  const v = crt.lines({ stage: 'researching', topic: null, note: 'Getting ready', since: '2026-10-05T20:06:00Z' }, NAMES, NOW);
  assert.equal(v.ready, false);
  assert.equal(v.head, 'Getting ready');
  assert.equal(v.note, '', 'the note is the head, so it is not said twice');
  assert.equal(v.minutes, 4);
});

test('every working stage is live, with no topic and no note: her name for the stage', () => {
  for (const stage of ['researching', 'council', 'distill', 'shelving', 'fetching']) {
    const v = crt.lines({ stage }, NAMES, NOW);
    assert.equal(v.ready, false, stage);
    assert.equal(v.head, NAMES[stage] || stage, stage);
  }
  assert.equal(crt.lines({ stage: 'council' }, undefined, NOW).head, 'council', 'no copy: the stage itself');
});

test('with a topic, the topic leads and the note is the second line, with the step', () => {
  const v = crt.lines({ stage: 'researching', topic: 'Frost dates for raised beds', note: 'Reading sources', step: { n: 2, of: 5 } }, NAMES, NOW);
  assert.deepEqual([v.head, v.note, v.step], ['Frost dates for raised beds', 'Reading sources', { n: 2, of: 5 }]);
  const c = crt.lines({ stage: 'council', note: 'Five readers on 3 topics', step: { n: 2, of: 4 } }, NAMES, NOW);
  assert.deepEqual([c.head, c.note, c.step], ['Five readers on 3 topics', '', { n: 2, of: 4 }]);
});

test('a step that does not add up is left out', () => {
  for (const step of [null, { n: 0, of: 5 }, { n: 6, of: 5 }, { n: 1, of: 0 }, { n: 'x', of: 3 }, { n: 1.5, of: 3 }]) {
    assert.equal(crt.lines({ stage: 'distill', topic: 'T', step }, NAMES, NOW).step, null, JSON.stringify(step));
  }
});

test('the minutes come from since, and are null when since is missing, unreadable or later than now', () => {
  const at = (since) => crt.lines({ stage: 'distill', topic: 'T', since }, NAMES, NOW).minutes;
  assert.equal(at('2026-10-05T20:09:30Z'), 0);
  assert.equal(at('2026-10-05T18:55:00Z'), 75);
  assert.equal(at(null), null);
  assert.equal(at('not a time'), null);
  assert.equal(at('2026-10-05T20:20:00Z'), null);
});
