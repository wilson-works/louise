'use strict';

/**
 * run-helpers.test.js — the two scripts a run started from her dashboard uses instead of writing its own:
 * engine/run-state.js (the marathon-research state file: merge, put a wave, get; only the library's own state file)
 * and engine/check-citations.js (the skill's citation check; only a folder inside her library). Hermetic: temporary
 * folders; the CLIs run with this Node from a temporary copy of her folder.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const runState = require('../engine/run-state');
const { check } = require('../engine/check-citations');
const { makeLibrary, tmpdir, write } = require('./fixtures');

test('run-state: set merges keys, wave puts or replaces by slug, get reads; bad JSON leaves the file as it was', () => {
  const file = path.join(tmpdir('rs'), 'marathon-research-state.json');
  assert.deepEqual(runState.apply(file, 'get'), {});
  runState.apply(file, 'set', '{"sessionId":"research-1","status":"running","queue":[{"title":"A"}]}');
  runState.apply(file, 'wave', '{"slug":"2026-10-05-a","status":"in-progress","waveNumber":1}');
  runState.apply(file, 'wave', '{"slug":"2026-10-05-a","status":"complete"}');
  runState.apply(file, 'wave', '{"slug":"2026-10-05-b","status":"in-progress","waveNumber":2}');
  runState.apply(file, 'set', '{"status":"complete"}');
  const s = runState.apply(file, 'get');
  assert.equal(s.sessionId, 'research-1');
  assert.equal(s.status, 'complete');
  assert.deepEqual(s.waves, [{ slug: '2026-10-05-a', status: 'complete', waveNumber: 1 }, { slug: '2026-10-05-b', status: 'in-progress', waveNumber: 2 }]);
  const before = fs.readFileSync(file, 'utf8');
  for (const bad of ['{nope', '[1]', '"x"', 'null']) assert.throws(() => runState.apply(file, 'set', bad), (e) => e.code === 2, bad);
  assert.throws(() => runState.apply(file, 'rm', '{}'), (e) => e.code === 2);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('run-state: the file is always the library\'s own state file, never a path from the command line', () => {
  const lib = makeLibrary();
  const cfg = { writeRoot: lib.root, roots: lib.roots };
  assert.equal(runState.stateFileFor(cfg), path.join(lib.root, 'marathon-research-state.json'));
  assert.equal(runState.stateFileFor({ writeRoot: null, roots: [] }), null);
  // From the CLI: an extra argument (a path) is refused, and nothing outside the library is written.
  const home = tmpdir('rs-home');
  fs.cpSync(path.join(__dirname, '..', 'engine'), path.join(home, 'engine'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(home, 'package.json'));
  const libDir = path.join(home, 'lib');
  fs.writeFileSync(path.join(home, 'louise.config.json'), JSON.stringify({ library: { roots: [{ label: 'T', path: libDir }] } }));
  const run = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join('engine', 'run-state.js'), ...a], { cwd: home, encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  const elsewhere = path.join(home, 'elsewhere.json');
  assert.equal(run('set', '{"a":1}', elsewhere).code, 2);
  assert.equal(fs.existsSync(elsewhere), false);
  assert.equal(run('set', '{"status":"running"}').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(libDir, 'marathon-research-state.json'), 'utf8')).status, 'running');
});

test('check-citations: the skill\'s rules, and only a folder inside her library', () => {
  const dir = path.join(tmpdir('cc'), '2026-10-05-a');
  write(path.join(dir, '00-brief.md'), 'The brief has 3 facts with no source.\n');
  write(path.join(dir, 'sources.md'), '# Sources\n\n[^1]: [A](https://example.org/a)\n');
  write(path.join(dir, '01-overview.md'), [
    '# Overview', '', 'The first library opened in 1833 [^1].', 'Soil warms by 2 degrees under fleece.', '', '', '', '',
    'See the sources for more.', 'Facts in this list:', '```', 'code 123', '```', 'It was cited inline https://example.org/b',
    'A claim with an undefined note was made [^9].',
  ].join('\n'));
  const r = check(dir);
  assert.equal(r.totalClaims, 4);
  // Line numbers are counted after code blocks are taken out, as in the skill: the [^9] line is line 13.
  assert.deepEqual(r.flaggedDetails.map((d) => d.lineNumber), [4, 13]);
  assert.equal(r.flaggedClaims, 2);

  const lib = makeLibrary();
  const home = tmpdir('cc-home');
  fs.cpSync(path.join(__dirname, '..', 'engine'), path.join(home, 'engine'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(home, 'package.json'));
  fs.writeFileSync(path.join(home, 'louise.config.json'), JSON.stringify({ library: { roots: [{ label: 'T', path: lib.root }] } }));
  const run = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join('engine', 'check-citations.js'), ...a], { cwd: home, encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  const inLib = run(path.join(lib.root, '2026-09-01-frost-dates'));
  assert.equal(inLib.code, 0);
  assert.match(inLib.out, /^CLAIMS:\d+ FLAGGED:\d+/);
  assert.equal(run(dir).code, 2, 'a folder outside her library is refused');
  assert.equal(run(lib.root).code, 2, 'the library root itself is not a topic folder');
  assert.equal(run(path.join(lib.root, '..', '..')).code, 2);
});
