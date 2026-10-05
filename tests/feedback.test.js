'use strict';

/**
 * feedback.test.js — engine/feedback.js and POST /api/feedback: what Louise remembers about the books she fetched.
 * An answer is refused when it is malformed, names a book that is not on the shelves, or comes from another site;
 * a Yes moves a book up for similar questions and a No moves it down; the file keeps the last 2,000 answers; a book
 * that has gone is ignored; and the next-match flow the page runs (No, then the next of the fetch's matches) is
 * backed by what the server answers. Hermetic: temporary folders, a port from the system.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const feedback = require('../engine/feedback');
const library = require('../engine/library');
const { createServer } = require('../dashboard/server');
const { makeLibrary, tmpdir } = require('./fixtures');

const FROST = '0-t-2026-09-01-frost-dates';
const COUNCIL = '0-c-council-summary-2026-09-02T10-00';

let lib;
let server;
let port;

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Host: `127.0.0.1:${port}` }, headers) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body != null) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const post = (p, body, headers) => req('POST', p, body, Object.assign({ 'Content-Type': 'application/json' }, headers));

before(async () => {
  lib = makeLibrary();
  library.invalidate();
  server = createServer({ home: lib.home, roots: lib.roots });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

test('words: lower case, common and question words left out, plurals folded, each once, sorted', () => {
  assert.deepEqual(feedback.words('When can I plant Tomatoes outside?'), ['outside', 'plant', 'tomato']);
  assert.deepEqual(feedback.words('Is it safe to plant tomatoes outdoors? tomatoes!'), ['outdoor', 'plant', 'safe', 'tomato']);
  assert.deepEqual(feedback.words('what is the'), []);
});

test('tally: an answer counts when it shares at least half of the new question\'s words', () => {
  const answers = [
    { words: ['outside', 'plant', 'tomato'], book: 'a', helpful: true },
    { words: ['outside', 'plant', 'tomato'], book: 'b', helpful: false },
    { words: ['sourdough', 'starter'], book: 'c', helpful: true },
  ];
  const t = feedback.tally(answers, 'Is it safe to plant tomatoes outdoors?');
  assert.deepEqual(t.get('a'), { yes: 1, no: 0, net: 1 });
  assert.deepEqual(t.get('b'), { yes: 0, no: 1, net: -1 });
  assert.equal(t.has('c'), false);
  assert.equal(feedback.tally(answers, 'plant').get('a').net, 1, 'one word of one: counts');
  assert.equal(feedback.tally(answers, 'garden fence paint colour').size, 0);
});

test('record refuses a missing question, a question with no words, a missing yes/no and an unknown book', () => {
  const file = path.join(tmpdir('fb'), 'state', 'feedback.jsonl');
  const known = (id) => id === FROST;
  const bad = [
    [{ book: FROST, helpful: true }, 400], [{ q: '   ', book: FROST, helpful: true }, 400], [{ q: 42, book: FROST, helpful: true }, 400],
    [{ q: 'the what', book: FROST, helpful: true }, 400], [{ q: 'frost', book: FROST }, 400], [{ q: 'frost', book: FROST, helpful: 'yes' }, 400],
    [{ q: 'frost', book: 'nope', helpful: true }, 404], [{ q: 'frost', book: '../../etc', helpful: true }, 404], [{ q: 'frost', helpful: true }, 404],
  ];
  for (const [answer, status] of bad) {
    assert.throws(() => feedback.record(file, answer, { known }), (e) => e.status === status, JSON.stringify(answer));
  }
  assert.equal(fs.existsSync(file), false, 'nothing was written');
  const long = `frost ${'x'.repeat(400)} lettuce`;
  feedback.record(file, { q: long, book: FROST, helpful: true }, { known });
  const [kept] = feedback.read(file);
  assert.ok(!kept.words.includes('lettuce'), 'the question was cut to 300 characters before its words were taken');
  assert.deepEqual(Object.keys(kept), ['at', 'words', 'book', 'helpful']);
});

test('the file keeps the last 2,000 answers, skips damaged lines, and a book that has gone is ignored', () => {
  const file = path.join(tmpdir('fb'), 'state', 'feedback.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [];
  for (let i = 0; i < feedback.KEEP; i += 1) lines.push(JSON.stringify({ at: `n${i}`, words: ['frost'], book: FROST, helpful: true }));
  fs.writeFileSync(file, `${lines.join('\n')}\nnot json\n`);
  feedback.record(file, { q: 'last frost', book: COUNCIL, helpful: true }, { known: () => true });
  const kept = feedback.read(file);
  assert.equal(kept.length, feedback.KEEP);
  assert.equal(kept[0].at, 'n1', 'the oldest answer dropped off');
  assert.equal(kept[kept.length - 1].book, COUNCIL);

  const index = library.get(lib.roots);
  const hits = library.find(index, 'frost', { feedback: [{ words: ['frost'], book: '0-t-gone-away', helpful: true }] });
  assert.ok(hits.every((h) => h.book.id !== '0-t-gone-away'));
});

test('a Yes moves a book up for similar questions, a No moves it down', () => {
  const index = library.get(lib.roots);
  const before = library.find(index, 'what is the last frost date').map((h) => h.book.id);
  assert.equal(before[0], FROST);
  assert.ok(before.includes(COUNCIL));
  const answers = [
    { words: feedback.words('when is the last frost'), book: FROST, helpful: false },
    { words: feedback.words('when is the last frost'), book: COUNCIL, helpful: true },
  ];
  const hits = library.find(index, 'what is the last frost date', { feedback: answers });
  assert.equal(hits[0].book.id, COUNCIL);
  assert.equal(hits[0].yes, 1);
  assert.equal(hits[hits.length - 1].book.id, FROST);
  assert.equal(hits[hits.length - 1].no, 1);
  // A question that shares too little is not moved.
  assert.equal(library.find(index, 'frost dates for raised beds soil', { feedback: answers })[0].book.id, FROST);
  // A book confirmed for a similar question comes back even when its own words do not match.
  const confirmed = [{ words: ['frost', 'last'], book: '0-t-2026-08-20-rain-barrels', helpful: true }];
  assert.equal(library.find(index, 'when is the last frost', { feedback: confirmed })[0].book.id, '0-t-2026-08-20-rain-barrels');
});

test('POST /api/feedback is refused from another site, as a form, malformed, or for a book not on the shelves', async () => {
  const ok = { q: 'when is the last frost', book: FROST, helpful: false };
  assert.equal((await req('POST', '/api/feedback', 'q=frost', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 403);
  assert.equal((await post('/api/feedback', ok, { Origin: 'http://evil.example.org' })).status, 403);
  assert.equal((await post('/api/feedback', ok, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await req('POST', '/api/feedback', JSON.stringify(ok), { 'Content-Type': 'application/json', Host: 'evil.example.org' })).status, 403);
  assert.equal((await post('/api/feedback', '{nope')).status, 400);
  assert.equal((await post('/api/feedback', [ok])).status, 400);
  assert.equal((await post('/api/feedback', { q: 'frost', book: FROST })).status, 400);
  assert.equal((await post('/api/feedback', { q: 'frost', book: '0-t-nope', helpful: true })).status, 404);
  assert.equal((await post('/api/feedback', { q: 'x'.repeat(20 * 1024), book: FROST, helpful: true })).status, 413);
  assert.equal((await req('GET', '/api/feedback')).status, 405);
  assert.equal(fs.existsSync(feedback.feedbackFile(lib.home)), false, 'nothing was remembered');
});

test('the next-match flow: No on the book she brought, the next match, Yes, and a similar question brings the Yes first', async () => {
  const same = { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' };
  const first = await post('/api/fetch', { q: 'when is the last frost' }, same);
  assert.equal(first.status, 200);
  assert.equal(first.body.book, FROST);
  const next = first.body.matches.find((id) => id !== first.body.book);
  assert.equal(next, COUNCIL, 'the page opens the next of the fetch\'s matches after a No');
  assert.deepEqual((await post('/api/feedback', { q: 'when is the last frost', book: FROST, helpful: false }, same)).body, { remembered: 1 });
  assert.deepEqual((await post('/api/feedback', { q: 'when is the last frost', book: next, helpful: true }, same)).body, { remembered: 2 });
  const again = await post('/api/fetch', { q: 'what is the last frost date' }, same);
  assert.equal(again.body.book, COUNCIL);
  assert.equal(again.body.matches[again.body.matches.length - 1], FROST);
  const remembered = feedback.read(feedback.feedbackFile(lib.home));
  assert.deepEqual(remembered.map((a) => [a.book, a.helpful]), [[FROST, false], [COUNCIL, true]]);
  // Out of matches: the page offers to add the question to her list, through the request route.
  assert.deepEqual((await post('/api/request', { topic: 'when is the last frost' }, same)).body, { queued: 1 });
});
