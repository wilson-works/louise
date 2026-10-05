'use strict';

/**
 * library.test.js — engine/library.js reads Louise's shelves the way SPEC.md ("The library on disk") says: topic
 * folders at the root and under marathons/, failed and flagged, summary cards joined to their topics (by _index.md,
 * by name, else a book of their own), council proceedings with their notes on every topic they name, run summary
 * books and the runs they give their topics; nothing deeper than the layout, never a link; the four arrangements and
 * the search; find; and a page is read only inside its root, at most 512 KB, front matter left out.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const library = require('../engine/library');
const { makeLibrary, tmpdir, write } = require('./fixtures');

const byTitle = (index, title) => index.books.find((b) => b.title === title);

test('every shape in the layout becomes the right book', () => {
  const { roots } = makeLibrary();
  const index = library.buildIndex(roots);
  const frost = byTitle(index, 'Frost dates for raised beds');
  assert.equal(frost.id, '0-t-2026-09-01-frost-dates');
  assert.equal(frost.kind, 'topic');
  assert.equal(frost.status, 'finished');
  assert.equal(frost.date, '2026-09-01');
  assert.equal(frost.sources, 2);
  assert.equal(frost.run, 'research-2026-09-01T09-00', 'its run comes from the run summary book');

  const oven = byTitle(index, 'Wood-fired bread ovens');
  assert.ok(oven, 'a topic with no meta.json takes its title from the brief');
  assert.equal(oven.status, 'in-progress');
  assert.equal(oven.run, 'research-2026-10-03T08-00', 'its run comes from the marathon-research state file');
  assert.equal(oven.lines, 5, 'lines are counted when meta.json does not give them');

  assert.equal(byTitle(index, 'Rain barrels').status, 'finished', 'marathons/ topics are read');
  assert.equal(byTitle(index, 'The best hose').status, 'failed', 'marathons/failed/ is read');
  const garden = byTitle(index, 'The best garden');
  assert.equal(garden.status, 'failed');
  assert.equal(garden.id, '0-f-2026-09-01-the-best-garden');
  assert.equal(byTitle(index, 'A quiet home office').status, 'flagged');

  const council = index.books.find((b) => b.kind === 'council');
  assert.equal(council.title, 'Council notes: Garden', 'a council named by a run summary takes its title');
  assert.equal(council.pages.length, 2, 'the transcript is its second page');
  const run = index.books.find((b) => b.kind === 'run-summary');
  assert.equal(run.title, 'Garden');
  assert.equal(run.run, 'research-2026-09-01T09-00');
  assert.equal(index.books.filter((b) => b.kind === 'council').length, 1, 'only council-summary-*.md files are councils');
});

test('summary cards join their topics; a card with no topic is a book of its own', () => {
  const { roots } = makeLibrary();
  const index = library.buildIndex(roots);
  const frost = library.bookView(index, '0-t-2026-09-01-frost-dates');
  assert.deepEqual(frost.pages.map((p) => p.kind), ['brief', 'report', 'report', 'sources', 'card', 'council']);
  assert.deepEqual(frost.pages.map((p) => p.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(frost.pages[0].name, 'The question');
  assert.equal(frost.pages[4].file, 'summaries/frost.md', 'linked by _index.md, and the file is relative to its root');
  assert.equal(frost.pages[5].name, 'Reading-room notes');
  const rain = index.books.find((b) => b.title === 'Rain barrels');
  assert.ok(rain.pages.some((p) => p.kind === 'card'), 'linked by its name without the date');
  const compost = byTitle(index, 'Compost Heaps');
  assert.ok(compost, 'an orphan card is its own book');
  assert.equal(compost.kind, 'topic');
  assert.equal(compost.pages.length, 1);
  assert.ok(!index.books.some((b) => /_index/.test(b.slug)), 'files starting with _ are never cards');
  const quiet = library.bookView(index, '0-x-2026-10-02-quiet-office');
  assert.equal(quiet.pages[quiet.pages.length - 1].kind, 'validation');
});

test('nothing deeper than the layout is read, and links are never followed', (t) => {
  const { root, roots } = makeLibrary();
  const outside = tmpdir('outside');
  write(path.join(outside, '01-overview.md'), '# Outside\n');
  let linked = true;
  try { fs.symlinkSync(outside, path.join(root, '2026-01-03-linked'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (_) { linked = false; }
  const index = library.buildIndex(roots);
  const slugs = index.books.map((b) => b.slug);
  assert.ok(!slugs.includes('2026-01-01-too-deep'));
  assert.ok(!slugs.includes('2026-01-02-nested'));
  if (!linked) { t.diagnostic('could not make a link here; the link check was skipped'); return; }
  assert.ok(!slugs.includes('2026-01-03-linked'), 'a linked folder is not a topic');
});

test('a link named like one of her own folders (failed, flagged, runs, council, summaries) is never read', (t) => {
  const { roots } = makeLibrary();
  const outside = tmpdir('outside-named');
  write(path.join(outside, '2026-01-04-outside-topic', '01-overview.md'), '# Outside topic\n');
  write(path.join(outside, 'outside-stub.md'), '# Outside stub\n');
  write(path.join(outside, 'outside-run.md'), '---\nrun: outside\n---\n# Outside run\n');
  write(path.join(outside, 'council-summary-2026-01-04.md'), '# Outside council\n');
  write(path.join(outside, 'outside-card.md'), '# Outside card\n');
  const root = tmpdir('named-links');
  try {
    for (const name of ['failed', 'flagged', 'runs', 'council', 'summaries']) {
      fs.symlinkSync(outside, path.join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
  } catch (_) { t.diagnostic('could not make a link here; the check was skipped'); return; }
  const index = library.buildIndex([Object.assign({}, roots[0], { path: root, council: 'council', state: path.join(root, 'none.json') })]);
  assert.deepEqual(index.books.map((b) => b.title), [], 'nothing from outside the root reaches the shelves');
});

test('the four arrangements, and the search', () => {
  const { roots } = makeLibrary();
  const index = library.buildIndex(roots);
  const topic = library.shelves(index, { arrange: 'topic' });
  assert.equal(topic.books.length, index.books.length);
  assert.equal(topic.sections.reduce((a, s) => a + s.count, 0), topic.books.length, 'counts add up');
  assert.ok(topic.sections.some((s) => s.id === 'council') && topic.sections.some((s) => s.id === 'runs'));
  assert.equal(topic.books.find((b) => b.title === 'The best garden').section, 'a-e', '"The" is skipped when shelving');
  for (const b of topic.books) assert.deepEqual(Object.keys(b), ['id', 'title', 'section', 'kind', 'status', 'date', 'run', 'sources', 'lines', 'pages']);

  const run = library.shelves(index, { arrange: 'run' });
  const garden = run.sections.find((s) => s.label === 'Garden');
  assert.ok(garden, 'a run section takes its run summary title');
  assert.equal(run.books.find((b) => b.title === 'Rain barrels').section, 'day-2026-08-20', 'no run: shelved by the day');

  const month = library.shelves(index, { arrange: 'month' });
  assert.deepEqual(month.sections.slice(0, 2).map((s) => s.label), ['October 2026', 'September 2026'], 'newest month first');

  const status = library.shelves(index, { arrange: 'status' });
  assert.deepEqual(status.sections.map((s) => s.id), ['finished', 'in-progress', 'flagged', 'failed']);

  const q = library.shelves(index, { arrange: 'topic', q: 'frost' });
  assert.ok(q.books.length >= 1 && q.books.every((b) => /frost/i.test(b.title) || b.kind !== 'topic'));
  assert.equal(q.sections.reduce((a, s) => a + s.count, 0), q.books.length);
  assert.equal(topic.examples, false);

  assert.throws(() => library.shelves(index, { arrange: 'colour' }), (e) => e.status === 400);
});

test('find puts the best book first, and finds nothing for nothing', () => {
  const { roots } = makeLibrary();
  const index = library.buildIndex(roots);
  assert.equal(library.find(index, 'what do we have on frost dates?')[0].book.id, '0-t-2026-09-01-frost-dates');
  assert.equal(library.find(index, 'rain barrel')[0].book.title, 'Rain barrels');
  assert.deepEqual(library.find(index, 'volcano insurance'), []);
  assert.deepEqual(library.find(index, 'the of and'), []);
});

test('a page is read only inside its root, at most 512 KB, with front matter left out', () => {
  const { root, roots } = makeLibrary();
  const index = library.buildIndex(roots);
  const p = library.readPage(index, '0-t-2026-09-01-frost-dates', 2);
  assert.equal(p.name, 'Overview');
  assert.match(p.markdown, /average/);
  const runPage = library.readPage(index, '0-r-research-2026-09-01T09-00', 1);
  assert.ok(!runPage.markdown.includes('topics:'), 'front matter is left out');
  assert.match(runPage.markdown, /# Garden/);

  assert.throws(() => library.readPage(index, 'nope', 1), (e) => e.status === 404);
  assert.throws(() => library.readPage(index, '0-t-2026-09-01-frost-dates', 0), (e) => e.status === 404);
  assert.throws(() => library.readPage(index, '0-t-2026-09-01-frost-dates', 7), (e) => e.status === 404);

  fs.writeFileSync(path.join(root, '2026-09-01-frost-dates', '02-deep-dive.md'), 'x'.repeat(library.PAGE_CAP + 1));
  assert.throws(() => library.readPage(index, '0-t-2026-09-01-frost-dates', 3), (e) => e.status === 413);

  // A page whose file is outside the book's root is refused, even if the index were to name it.
  const outside = tmpdir('outside');
  write(path.join(outside, 'secret.md'), 'secret');
  const book = index.byId.get('0-t-2026-09-01-frost-dates');
  book.pages.push({ kind: 'report', name: 'Elsewhere', file: path.join(outside, 'secret.md') });
  assert.throws(() => library.readPage(index, book.id, book.pages.length), (e) => e.status === 403);
  book.pages.push({ kind: 'report', name: 'Up and out', file: path.join(root, '..', '..', path.basename(outside), 'secret.md') });
  assert.throws(() => library.readPage(index, book.id, book.pages.length), (e) => e.status === 403);
});

test('the example library has its two runs, a council, and one failed and one flagged topic', () => {
  const root = path.join(__dirname, '..', 'examples', 'library');
  const index = library.buildIndex([{ label: 'Examples', path: root, council: 'council', state: path.join(root, 'marathon-research-state.json'), example: true }]);
  const count = (f) => index.books.filter(f).length;
  assert.equal(count((b) => b.kind === 'topic'), 6);
  assert.equal(count((b) => b.status === 'failed'), 1);
  assert.equal(count((b) => b.status === 'flagged'), 1);
  assert.equal(count((b) => b.kind === 'council'), 1);
  assert.equal(count((b) => b.kind === 'run-summary'), 2);
  assert.equal(count((b) => b.kind === 'topic' && b.pages.some((p) => p.kind === 'card')), 4, 'four cards, each on its topic');
  assert.equal(library.shelves(index, {}).examples, true);
  for (const b of index.books) for (let n = 1; n <= b.pages.length; n += 1) library.readPage(index, b.id, n);
});
