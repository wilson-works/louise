'use strict';

/**
 * skills.test.js — engine/skills.js copies the skills her agent.json requires into her folder's .claude/skills before a
 * research run (so the run can leave the person's own settings out and still have them): copied from the Hub first,
 * else ~/.claude/skills; left alone when fresh; refreshed when the source is newer; reported missing when found
 * nowhere (and the research route then refuses with 409 no-skill); a link inside a source is never followed, and a
 * source folder that is itself a link is not used. Hermetic: fake Hub and home folders under the system's temp folder.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const skills = require('../engine/skills');
const { createServer } = require('../dashboard/server');
const requests = require('../engine/requests');
const { makeLibrary, tmpdir, write } = require('./fixtures');

function setup() {
  const home = tmpdir('sk-home');
  const hub = tmpdir('sk-hub');
  const homeDir = tmpdir('sk-user');
  write(path.join(home, 'agent.json'), JSON.stringify({ requires: { skills: ['alpha', 'beta', '../evil', 'Bad Name'] } }));
  write(path.join(hub, '.claude', 'skills', 'alpha', 'SKILL.md'), '# alpha from the hub\n');
  write(path.join(homeDir, '.claude', 'skills', 'alpha', 'SKILL.md'), '# alpha from home\n');
  write(path.join(homeDir, '.claude', 'skills', 'beta', 'SKILL.md'), '# beta from home\n');
  write(path.join(homeDir, '.claude', 'skills', 'beta', 'refs', 'notes.md'), 'notes\n');
  return { home, hub, homeDir, dest: (n) => path.join(home, '.claude', 'skills', n) };
}

test('required: only well-formed names from agent.json', () => {
  const s = setup();
  assert.deepEqual(skills.required(s.home), ['alpha', 'beta']);
  assert.equal(skills.sourceOf('../evil', { hub: s.hub, homeDir: s.homeDir }), null);
});

test('copied from the Hub first, else home; a real copy, not a link; then fresh; then refreshed when the source is newer', () => {
  const s = setup();
  const r1 = skills.ensure({ home: s.home, hub: s.hub, homeDir: s.homeDir });
  assert.deepEqual(r1, { copied: ['alpha', 'beta'], fresh: [], missing: [] });
  assert.equal(fs.readFileSync(path.join(s.dest('alpha'), 'SKILL.md'), 'utf8'), '# alpha from the hub\n');
  assert.equal(fs.readFileSync(path.join(s.dest('beta'), 'refs', 'notes.md'), 'utf8'), 'notes\n');
  assert.equal(fs.lstatSync(s.dest('beta')).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(path.join(s.dest('beta'), 'SKILL.md')).isSymbolicLink(), false);

  assert.deepEqual(skills.ensure({ home: s.home, hub: s.hub, homeDir: s.homeDir }), { copied: [], fresh: ['alpha', 'beta'], missing: [] });

  const src = path.join(s.homeDir, '.claude', 'skills', 'beta', 'SKILL.md');
  fs.writeFileSync(src, '# beta, newer\n');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(src, later, later);
  assert.deepEqual(skills.ensure({ home: s.home, hub: s.hub, homeDir: s.homeDir }), { copied: ['beta'], fresh: ['alpha'], missing: [] });
  assert.equal(fs.readFileSync(path.join(s.dest('beta'), 'SKILL.md'), 'utf8'), '# beta, newer\n');
  assert.equal(fs.existsSync(path.join(s.dest('beta'), 'refs', 'notes.md')), true);

  // A copy edited in place (or deleted) is put back from the source.
  fs.rmSync(path.join(s.dest('alpha'), 'SKILL.md'));
  assert.deepEqual(skills.ensure({ home: s.home, hub: s.hub, homeDir: s.homeDir }).copied, ['alpha']);
});

test('missing when found nowhere, or with no SKILL.md, or over the size limit', () => {
  const s = setup();
  assert.deepEqual(skills.ensure({ home: s.home, hub: null, homeDir: tmpdir('sk-empty') }).missing, ['alpha', 'beta']);
  const nomd = tmpdir('sk-nomd');
  write(path.join(nomd, '.claude', 'skills', 'alpha', 'README.md'), 'no skill file\n');
  assert.deepEqual(skills.ensure({ home: s.home, hub: null, homeDir: nomd, names: ['alpha'] }).missing, ['alpha']);
  const big = tmpdir('sk-big');
  write(path.join(big, '.claude', 'skills', 'alpha', 'SKILL.md'), '# alpha\n');
  fs.writeFileSync(path.join(big, '.claude', 'skills', 'alpha', 'huge.bin'), Buffer.alloc(skills.MAX_BYTES + 1));
  assert.deepEqual(skills.ensure({ home: s.home, hub: null, homeDir: big, names: ['alpha'] }).missing, ['alpha']);
});

test('a link inside a source is never followed, and a source folder that is a link is not used', () => {
  const s = setup();
  const secret = tmpdir('sk-secret');
  write(path.join(secret, 'private.txt'), 'not to be copied\n');
  const betaSrc = path.join(s.homeDir, '.claude', 'skills', 'beta');
  fs.symlinkSync(secret, path.join(betaSrc, 'linked'), 'junction');
  skills.ensure({ home: s.home, hub: null, homeDir: s.homeDir, names: ['beta'] });
  assert.equal(fs.existsSync(path.join(s.dest('beta'), 'linked')), false);
  assert.equal(fs.existsSync(path.join(s.dest('beta'), 'SKILL.md')), true);

  const linkedHome = tmpdir('sk-linkhome');
  fs.mkdirSync(path.join(linkedHome, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(s.homeDir, '.claude', 'skills', 'alpha'), path.join(linkedHome, '.claude', 'skills', 'alpha'), 'junction');
  assert.deepEqual(skills.ensure({ home: tmpdir('sk-home2'), hub: null, homeDir: linkedHome, names: ['alpha'] }).missing, ['alpha']);
});

test('POST /api/research refuses with 409 no-skill when a required skill is installed nowhere, and starts nothing', async () => {
  const lib = makeLibrary();
  write(path.join(lib.home, 'agent.json'), JSON.stringify({ requires: { skills: ['marathon-research'] } }));
  requests.add(requests.queueFile(lib.home), { topic: 'Frost dates for raised beds' });
  const fake = path.join(tmpdir('sk-fake'), 'fake-claude.js');
  write(fake, 'process.exit(0)\n');
  let launched = false;
  const server = createServer({ home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake, hub: null, homeDir: tmpdir('sk-none'), launch: () => { launched = true; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const res = await new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/research', headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' } }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
    });
    rq.on('error', reject);
    rq.end('{}');
  });
  await new Promise((r) => server.close(r));
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'no-skill');
  assert.match(res.body.error, /^I need the marathon-research skill installed to research\./);
  assert.equal(launched, false);
});
