'use strict';

/**
 * manifest.test.js — Louise's package keeps the Workspace agent contract: agent.json has her key, name, door, probe,
 * start, match, images and required skills; her title, line and jokes are lane V's words from brand/copy.json; the
 * files it names are in her folder; it passes the Workspace's own validateManifest (agents/lib/agents.js), found
 * through WORKSPACE_DIR, else <Hub>/50-AI/workspace above her folder, else a workspace folder beside hers (skipped,
 * and said so, when there is none); subagent.md is a Claude Code subagent that reads her CLAUDE.md.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOME = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(HOME, f), 'utf8').replace(/^\uFEFF/, ''));
const manifest = readJson('agent.json');

test('agent.json says who she is, where her door is and how to start her', () => {
  assert.equal(manifest.key, 'louise');
  assert.equal(manifest.name, 'Louise');
  assert.equal(manifest.status, 'live');
  assert.deepEqual(manifest.door, { local: 'http://127.0.0.1:7540/', phone: null });
  assert.deepEqual(manifest.probe, { port: 7540, path: '/health' });
  assert.equal(manifest.start, 'node dashboard/server.js');
  assert.equal(manifest.autostart, true);
  assert.deepEqual(manifest.match, ['louise', 'librarian']);
  assert.equal(manifest.art, 'art.svg');
  assert.equal(manifest.brand.mark, 'mark.svg');
  assert.deepEqual(manifest.requires, { skills: ['marathon-research', 'marathon-research-council', 'distill', 'quick-research'] });
  for (const c of ['bg', 'panel', 'ink', 'accent', 'accent2']) assert.match(manifest.brand[c], /^#[0-9a-fA-F]{6}$/, c);
});

test('her title, line and jokes are the ones in brand/copy.json', () => {
  const copy = readJson('brand/copy.json');
  assert.equal(manifest.title, copy.title);
  assert.equal(manifest.line, copy.line);
  assert.deepEqual(manifest.jokes, copy.jokes);
});

test('the files agent.json names are in her folder, and her dashboard starts from it', () => {
  for (const f of [manifest.art, manifest.brand.mark, 'dashboard/server.js', 'CLAUDE.md', 'subagent.md']) {
    assert.ok(fs.statSync(path.join(HOME, f)).isFile(), `${f} is missing`);
  }
  assert.equal(readJson('package.json').type, 'commonjs');
  assert.equal(readJson('dashboard/package.json').type, 'commonjs');
});

function findWorkspace() {
  const tries = [];
  if (process.env.WORKSPACE_DIR) tries.push(process.env.WORKSPACE_DIR);
  for (let dir = path.resolve(HOME); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.hub', 'hub.json'))) { tries.push(path.join(dir, '50-AI', 'workspace')); break; }
    if (path.dirname(dir) === dir) break;
  }
  tries.push(path.join(HOME, '..', 'workspace'));
  return tries.map((d) => path.join(d, 'agents', 'lib', 'agents.js')).find((f) => fs.existsSync(f)) || null;
}

test("agent.json passes the Workspace's own validateManifest", (t) => {
  const lib = findWorkspace();
  if (!lib) { t.skip('no Workspace found: set WORKSPACE_DIR to a Workspace folder to run this check'); return; }
  assert.deepEqual(require(lib).validateManifest(manifest), { ok: true, errors: [] });
});

test('subagent.md is a Claude Code subagent called louise that reads her CLAUDE.md first', () => {
  const text = fs.readFileSync(path.join(HOME, 'subagent.md'), 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'front matter between --- lines');
  assert.match(m[1], /^name: louise$/m);
  assert.match(m[1], /^description: .*Louise, research my list/m, 'the phrase her dashboard teaches routes to her');
  assert.match(m[1], /^model: \S+$/m);
  assert.match(m[2], /\{\{agent_dir\}\}\/CLAUDE\.md/);
});
