'use strict';

/**
 * tests/fixtures.js — a temporary library for the tests, in every shape engine/library.js reads, plus the things it
 * must never read. Not a test file itself. Everything is made under the system's temporary folder.
 *
 *   makeLibrary()  { root, roots, home } where roots is what engine/config.js would give for that root
 *   tmpdir(name)   a fresh temporary folder
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpdir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `louise-${name || 'test'}-`)); }

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function makeLibrary() {
  const home = tmpdir('home');
  const root = path.join(home, 'library');
  const w = (rel, text) => write(path.join(root, ...rel.split('/')), text);

  // A finished topic, with a deep dive, sources and meta.json.
  w('2026-09-01-frost-dates/00-brief.md', '# Scope Brief: Frost dates\n\n## Restated topic\n\nWhen is the last frost?\n');
  w('2026-09-01-frost-dates/01-overview.md', '# Overview\n\nThe last frost date is an average [^1].\n');
  w('2026-09-01-frost-dates/02-deep-dive.md', '# In depth\n\nSoil at 13 C [^2].\n');
  w('2026-09-01-frost-dates/sources.md', '# Sources\n\n[^1]: [A](https://example.org/a)\n[^2]: [B](https://example.org/b)\n');
  w('2026-09-01-frost-dates/meta.json', JSON.stringify({ slug: '2026-09-01-frost-dates', title: 'Frost dates for raised beds', status: 'complete', totalLines: 6, sourceCount: 2 }));
  // A topic still being written: no meta.json; its title comes from the brief.
  w('2026-10-03-bread-ovens/00-brief.md', '# Scope Brief — Wood-fired bread ovens\n');
  w('2026-10-03-bread-ovens/01-overview.md', '# Overview\n\nline\nline\nline\n');
  // A topic in the marathons/ layout, and its failed stub.
  w('marathons/2026-08-20-rain-barrels/00-brief.md', '# Scope Brief: Rain barrels\n');
  w('marathons/2026-08-20-rain-barrels/01-overview.md', '# Overview\n');
  w('marathons/2026-08-20-rain-barrels/meta.json', JSON.stringify({ title: 'Rain barrels', status: 'complete', sourceCount: 4, totalLines: 1 }));
  w('marathons/failed/2026-08-20-the-best-hose.md', '# FAILED — The best hose\n\nToo vague.\n');
  // Failed and flagged at the top.
  w('failed/2026-09-01-the-best-garden.md', '# FAILED — The best garden\n\nBest for what?\n');
  w('flagged/2026-10-02-quiet-office/00-brief.md', '# Scope Brief: A quiet home office\n');
  w('flagged/2026-10-02-quiet-office/01-overview.md', '# Overview\n\nA claim.\n');
  w('flagged/2026-10-02-quiet-office/_validation-report.md', '# Validation Report\n');
  // Summary cards: one linked by _index.md, one by its name, one with no topic on the shelves.
  w('_index.md', '# Research Index\n\n### Frost Dates\n\n- 2026-09-01-frost-dates/\n- `summaries/frost.md` — the card\n');
  w('summaries/frost.md', '# Frost Dates — Summary\n\nKey facts.\n');
  w('summaries/rain-barrels.md', '# Rain Barrels — Summary\n');
  w('summaries/compost-heaps.md', '# Compost Heaps — Summary\n\nA card from an older run, 2026-07-01.\n');
  w('summaries/_index.md', 'not a card');
  // A council naming the frost topic, with its transcript.
  w('council/council-summary-2026-09-02T10-00.md', '# Marathon-Research Council Summary — 2026-09-02\n\n### 2026-09-01-frost-dates\n\nDecision.\n');
  w('council/council-transcript-2026-09-02T10-00.md', '# Transcript\n');
  w('council/notes.md', 'not a council summary');
  // A run summary book, with front matter.
  w('runs/research-2026-09-01T09-00.md', '---\nrun: research-2026-09-01T09-00\ntitle: Garden\ndate: 2026-09-01\ntopics: [2026-09-01-frost-dates, 2026-09-01-the-best-garden]\ncouncil: council-summary-2026-09-02T10-00.md\n---\n\n# Garden\n\nBody.\n');
  // The marathon-research state file names the run of the bread-oven topic.
  w('marathon-research-state.json', JSON.stringify({ sessionId: 'research-2026-10-03T08-00', status: 'complete', waves: [{ slug: '2026-10-03-bread-ovens', status: 'complete' }], queue: [] }));
  // Things the library must never read: a topic two levels down, and one inside a topic folder.
  w('archive/2026-01-01-too-deep/01-overview.md', '# Too deep\n');
  w('2026-09-01-frost-dates/2026-01-02-nested/01-overview.md', '# Nested\n');

  const roots = [{ label: 'Test library', path: root, council: 'council', state: path.join(root, 'marathon-research-state.json'), example: false }];
  return { home, root, roots };
}

module.exports = { makeLibrary, tmpdir, write };
