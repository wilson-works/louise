'use strict';

/**
 * research.test.js — engine/research.js and the dashboard's research routes. Never real Claude Code: a harmless fake
 * program in a temporary folder records the arguments it was given, then waits to be stopped.
 *
 * The routes refuse a foreign Host, a cross-site page and a form POST; an empty list; a second start while a run is
 * going. A run gets only the fixed arguments, whatever the request body says. Stop acts only on the pid it recorded:
 * a pid named in the body is ignored, a run file whose pid is now another program is not trusted, nor is one whose
 * runner has gone quiet. findClaude reads npm's .cmd shim for the program it names, and never falls back to cmd.exe;
 * after the config, the PATH and ~/.local/bin it looks in npm's folder and in the newest VS Code extension (versions
 * compared as numbers), and status says where it found it.
 * A run whose runner and program are gone is found interrupted (on status and on start): marked ended, her stage at
 * rest, the topics it left offered; a plain start is refused until "Pick up where I left off" starts a run over just
 * those topics, word for word, with her newer requests left on her list. A run that still beats, or whose program
 * still works, is never called interrupted. Stop records what the stopped run left, without blocking a plain start.
 * A live pid whose program cannot be read (tasklist out of reach, as when it times out) is never taken for gone, and
 * start does not start a second run beside it. A run Claude Code ended with an error code (the usage limit) is offered
 * like an interrupted one, recorded once; Stop's own record and a clean end (code 0) are left as they are.
 * The permission flags are pinned to a literal list written out here (not ARGS itself), so a later widening fails. The real detached start (engine/research-run.js, through detach.vbs on Windows) runs the fake too.
 * Hermetic: temporary folders, ports from the system.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const research = require('../engine/research');
const stage = require('../engine/stage');
const requests = require('../engine/requests');
const { createServer } = require('../dashboard/server');
const { makeLibrary, tmpdir, write } = require('./fixtures');

/** The fake: writes its argv and cwd to argv.json beside it, then waits (up to a minute) to be stopped. */
function makeFake() {
  const dir = tmpdir('fake-claude');
  const file = path.join(dir, 'fake-claude.js');
  write(file, `require('fs').writeFileSync(require('path').join(__dirname, 'argv.json'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
setTimeout(() => {}, 60000);\n`);
  return { dir, file, argv: () => JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')) };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const waitFor = async (fn, ms) => { const until = Date.now() + (ms || 10000); while (Date.now() < until) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

/** A launch for the tests: starts the job's program (the fake) as a plain child and keeps the run file like the runner. */
const children = [];
function fakeLaunch(job) {
  const child = spawn(job.program, job.args, { cwd: job.cwd, stdio: 'ignore' });
  children.push(child);
  fs.writeFileSync(job.runFile, JSON.stringify({ token: job.token, pid: child.pid, runner: process.pid, image: job.image, program: job.program, started: new Date().toISOString(), beat: new Date().toISOString() }));
  child.on('exit', () => {
    try {
      const r = JSON.parse(fs.readFileSync(job.runFile, 'utf8'));
      if (r.token === job.token && !r.ended) fs.writeFileSync(job.runFile, JSON.stringify(Object.assign(r, { ended: new Date().toISOString() })));
    } catch (_) { /* gone */ }
  });
}

function client(port) {
  return function req(method, p, body, headers) {
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
  };
}

async function serve(opts) {
  const server = createServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const req = client(server.address().port);
  const post = (p, body, headers) => req('POST', p, body, Object.assign({ 'Content-Type': 'application/json' }, headers));
  return { server, req, post, port: server.address().port };
}

let lib;
let fake;
let s;

before(async () => {
  lib = makeLibrary();
  fake = makeFake();
  s = await serve({ home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake.file, launch: fakeLaunch });
});
after(async () => {
  for (const c of children) { try { c.kill(); } catch (_) { /* gone */ } }
  await new Promise((r) => s.server.close(r));
});

test('the research routes refuse a foreign Host, a page on another site and a form POST', async () => {
  for (const p of ['/api/research', '/api/research/stop']) {
    assert.equal((await s.req('POST', p, '{}', { 'Content-Type': 'application/json', Host: 'evil.example.org' })).status, 403, p);
    assert.equal((await s.post(p, {}, { Origin: 'http://evil.example.org' })).status, 403, p);
    assert.equal((await s.post(p, {}, { Origin: 'null' })).status, 403, p);
    assert.equal((await s.post(p, {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, p);
    assert.equal((await s.req('POST', p, 'go=1', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 403, p);
    assert.equal((await s.req('POST', p, '{}', { 'Content-Type': 'text/plain' })).status, 403, p);
    assert.equal((await s.req('GET', '/api/research/stop')).status, 405);
  }
  assert.equal(fs.existsSync(research.runFile(lib.home)), false, 'nothing was started');
});

test('an empty list is refused, and so is a computer without Claude Code or a library folder', async () => {
  const r = await s.post('/api/research', {});
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'Nothing on my list yet.', reason: 'empty' });
  const st = await s.req('GET', '/api/research');
  assert.deepEqual(st.body, { running: false, since: null, waiting: 0, claude: true, claudeFrom: `Named in louise.config.json: ${fake.file}`, unfinished: null });

  const lib2 = makeLibrary();
  requests.add(requests.queueFile(lib2.home), { topic: 'Frost dates for raised beds' });
  const none = await serve({ home: lib2.home, roots: lib2.roots, writeRoot: lib2.root, claude: path.join(lib2.home, 'no-such-claude.exe'), launch: fakeLaunch });
  const nc = await none.post('/api/research', {});
  assert.equal(nc.status, 409);
  assert.equal(nc.body.reason, 'no-claude');
  assert.match(nc.body.error, /^I need Claude Code on this computer to do research\./);
  assert.equal((await none.req('GET', '/api/research')).body.claude, false);
  assert.match((await none.req('GET', '/api/research')).body.claudeFrom, /^louise\.config\.json names .*no-such-claude\.exe as Claude Code, but there is no program there\.$/);
  await new Promise((r) => none.server.close(r));

  const nolib = await serve({ home: lib2.home, roots: lib2.roots, writeRoot: null, claude: fake.file, launch: fakeLaunch });
  assert.equal((await nolib.post('/api/research', {})).body.reason, 'no-library');
  await new Promise((r) => nolib.server.close(r));
});

test('a run gets only the fixed arguments; a second start is refused; stop ignores a pid in the body and stops only its own', async () => {
  requests.add(requests.queueFile(lib.home), { topic: 'When can I plant tomatoes outside?' });
  const started = await s.post('/api/research', { program: 'calc.exe', args: ['--dangerously-skip-permissions'], prompt: 'something else', pid: 1 });
  assert.equal(started.status, 202);
  assert.equal(started.body.running, true);
  assert.ok(await waitFor(() => fs.existsSync(path.join(fake.dir, 'argv.json'))), 'the fake ran');
  const got = fake.argv();
  assert.deepEqual(got.argv, research.ARGS(lib.home, lib.root));
  assert.equal(fs.realpathSync(got.cwd), fs.realpathSync(lib.home), 'it runs in her folder, so her CLAUDE.md loads');
  assert.equal(got.argv[0], '-p');
  assert.equal(got.argv[1], 'Louise, research my list.');
  for (const banned of ['calc.exe', '--dangerously-skip-permissions', 'something else', 'bypassPermissions']) assert.ok(!got.argv.includes(banned), banned);
  assert.equal(stage.readOwn(stage.stageFile(lib.home)).stage, 'researching');

  const st = await s.req('GET', '/api/research');
  assert.equal(st.body.running, true);
  const again = await s.post('/api/research', {});
  assert.equal(again.status, 409);
  assert.deepEqual(again.body, { error: "I'm already working on my list.", reason: 'running' });

  const pid = started.body.pid;
  const stopped = await s.post('/api/research/stop', { pid: process.pid });
  assert.equal(stopped.status, 200);
  assert.ok(alive(process.pid), 'the pid in the body was not touched');
  assert.ok(await waitFor(() => !alive(pid)), 'the recorded run was stopped');
  const own = stage.readOwn(stage.stageFile(lib.home));
  assert.equal(own.stage, 'idle');
  assert.match(own.note, /Stopped/);
  assert.equal((await s.req('GET', '/api/research')).body.running, false);
  assert.equal((await s.post('/api/research/stop', {})).body.reason, 'not-running');
});

test('stop refuses a pid it did not record: another program under that pid, or a runner gone quiet', async () => {
  const home = makeLibrary().home;
  const sv = await serve({ home, roots: [], writeRoot: home, claude: fake.file, launch: fakeLaunch });
  const file = research.runFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = new Date().toISOString();
  // This test's own pid, recorded as if it were Claude Code: the image does not match, so it is not her run.
  fs.writeFileSync(file, JSON.stringify({ token: 't', pid: process.pid, image: 'claude.exe', started: now, beat: now }));
  let r = await sv.post('/api/research/stop', {});
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'not-running');
  assert.ok(alive(process.pid));
  // The right image, but the runner's heartbeat is five minutes old: not trusted either.
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ token: 't', pid: process.pid, image: path.basename(process.execPath), started: old, beat: old }));
  assert.equal((await sv.req('GET', '/api/research')).body.running, false);
  r = await sv.post('/api/research/stop', {});
  assert.equal(r.status, 409);
  assert.ok(alive(process.pid));
  await new Promise((res) => sv.server.close(res));
});

test('findClaude: the configured path wins; npm\'s .cmd shim is read for the program it names; an unreadable shim is not used', () => {
  const dir = tmpdir('claude-path');
  const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  write(exe, '');
  write(path.join(dir, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  const viaShim = research.findClaude({ env: { PATH: dir }, platform: 'win32' });
  assert.equal(viaShim.program, exe);
  assert.deepEqual(viaShim.args, []);
  assert.equal(viaShim.image, 'claude.exe');

  const js = research.findClaude({ claude: fake.file });
  assert.equal(js.program, process.execPath);
  assert.deepEqual(js.args, [fake.file]);
  assert.equal(research.findClaude({ claude: path.join(dir, 'missing') }), null, 'a configured path that is not there is not replaced by another');

  const unread = path.join(tmpdir('claude-shim'), 'claude.cmd');
  write(unread, '@echo off\r\nsomething-else.exe %*\r\n');
  assert.equal(research.launcher(unread, 'win32'), null, 'a shim naming no program is never run through cmd.exe');
  // On the PATH it is skipped (a Claude Code in ~/.local/bin, npm's folder or VS Code may still be found; never cmd.exe,
  // never the shim).
  const found = research.findClaude({ env: { PATH: path.dirname(unread) }, platform: 'win32' });
  assert.ok(!found || (found.program !== unread && !/cmd\.exe$/i.test(found.program)));
});

test('findClaude falls back to npm\'s folder, then the newest VS Code extension by number; the PATH and the config come first', () => {
  const home = tmpdir('claude-home');
  const appData = path.join(home, 'AppData', 'Roaming');
  const win = { env: { PATH: '', APPDATA: appData }, platform: 'win32', homeDir: home };
  const ext = (folder, name) => path.join(home, '.vscode', 'extensions', folder, 'resources', 'native-binary', name);
  assert.equal(research.findClaude(win), null, 'nothing anywhere');
  assert.match(research.claudeFrom(null), /^Not found\. I looked in louise\.config\.json, on the PATH, in ~\/\.local\/bin, in npm's folder and in the VS Code extension\.$/);

  // As text 2.1.95 sorts after 2.1.295; as numbers 2.1.295 is newer. 2.1.300 is newest but has no program: passed over.
  write(ext('anthropic.claude-code-2.1.95-win32-x64', 'claude.exe'), '');
  write(ext('anthropic.claude-code-2.1.295-win32-x64', 'claude.exe'), '');
  fs.mkdirSync(path.join(home, '.vscode', 'extensions', 'anthropic.claude-code-2.1.300-win32-x64', 'resources'), { recursive: true });
  write(path.join(home, '.vscode', 'extensions', 'other.extension-9.9.9', 'resources', 'native-binary', 'claude.exe'), '');
  const vs = research.findClaude(win);
  assert.equal(vs.program, ext('anthropic.claude-code-2.1.295-win32-x64', 'claude.exe'));
  assert.equal(vs.from, 'vscode');
  assert.equal(vs.version, '2.1.295');
  assert.equal(research.claudeFrom(vs), `Found in the Claude Code extension for VS Code, version 2.1.295: ${vs.program}`);
  // Elsewhere the program is called claude, and the Windows builds are not it.
  write(ext('anthropic.claude-code-2.1.290-linux-x64', 'claude'), '');
  assert.equal(research.findClaude({ env: { PATH: '' }, platform: 'linux', homeDir: home }).program, ext('anthropic.claude-code-2.1.290-linux-x64', 'claude'));
  assert.ok(research.compareVersions('2.1.295', '2.1.95') > 0 && research.compareVersions('2.10', '2.9.9') > 0 && research.compareVersions('2.1', '2.1.0') === 0);

  // npm's folder comes before VS Code: its claude.exe, and its claude.cmd read for the program it names.
  const npmExe = path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  write(npmExe, '');
  assert.deepEqual([research.findClaude(win).program, research.findClaude(win).from], [npmExe, 'npm']);
  write(path.join(appData, 'npm', 'claude.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  const viaNpm = research.findClaude(win);
  assert.equal(viaNpm.program, npmExe);
  if (process.platform === 'win32') assert.equal(viaNpm.via, path.join(appData, 'npm', 'claude.cmd'));
  assert.match(research.claudeFrom(viaNpm), /^Found in npm's folder: /);
  // With no APPDATA, npm's folder is the one under the home folder.
  assert.equal(research.findClaude({ env: { PATH: '' }, platform: 'win32', homeDir: home }).program, npmExe);

  // ~/.local/bin, then the PATH, come before both; the config wins over everything.
  write(path.join(home, '.local', 'bin', 'claude.exe'), '');
  assert.equal(research.findClaude(win).from, 'local-bin');
  const onPath = tmpdir('claude-onpath');
  write(path.join(onPath, 'claude.exe'), '');
  const p = research.findClaude(Object.assign({}, win, { env: { PATH: onPath, APPDATA: appData } }));
  assert.deepEqual([p.program, p.from], [path.join(onPath, 'claude.exe'), 'path']);
  assert.equal(research.findClaude(Object.assign({}, win, { claude: fake.file })).from, 'config');
  assert.equal(research.findClaude(Object.assign({}, win, { claude: path.join(home, 'missing.exe') })), null, 'a configured path that is not there is never replaced');
});

/** A pid that was alive a moment ago and is not now. */
async function deadPid() {
  const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => c.once('exit', r));
  return c.pid;
}

const STARTED = '2026-10-08T23:00:00.000Z';
const BEAT = '2026-10-09T01:30:00.000Z';

/**
 * Her folder after a 3-topic run died in its second topic: the list it took, its first topic finished in the library,
 * a newer request on her list, her stage still on the dead run, and its run file never ended. runner: whose pid the
 * run file names as its runner (this test's own pid is the server's, so never her runner).
 */
function diedMidRun(pid, runner) {
  const lib = makeLibrary();
  const queue = requests.queueFile(lib.home);
  requests.add(queue, { topic: 'Bread ovens at home', framing: 'A small garden.' }, Date.parse('2026-10-08T20:00:00Z'));
  requests.add(queue, { topic: 'Rain barrels', framing: 'Two downpipes.\n# not a heading' }, Date.parse('2026-10-08T20:01:00Z'));
  requests.add(queue, { topic: 'Sourdough starter care' }, Date.parse('2026-10-08T20:02:00Z'));
  requests.take(queue, Date.parse('2026-10-08T23:00:05Z'));
  requests.add(queue, { topic: 'No question just you stalled out' }, Date.parse('2026-10-09T05:47:00Z'));
  write(path.join(lib.root, '2026-10-08-bread-ovens-at-home', 'meta.json'), JSON.stringify({ title: 'Bread ovens at home', status: 'complete' }));
  write(path.join(lib.root, '2026-10-08-rain-barrels', '00-brief.md'), '# Scope Brief: Rain barrels\n');
  stage.set(stage.stageFile(lib.home), 'researching', { topic: 'Rain barrels', step: '2/3', note: 'Reading sources' }, Date.parse('2026-10-09T01:00:00Z'));
  write(research.runFile(lib.home), JSON.stringify({ token: 'dead', pid, runner, image: 'claude.exe', program: 'claude.exe', started: STARTED, beat: BEAT }));
  return lib;
}

test('a run whose runner and program are gone is interrupted; Pick up where I left off runs just what it left', async () => {
  const lib = diedMidRun(await deadPid(), process.pid);
  const fake5 = makeFake();
  const sv = await serve({ home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake5.file, launch: fakeLaunch });
  try {
    const st = (await sv.req('GET', '/api/research')).body;
    assert.equal(st.running, false);
    assert.deepEqual(st.unfinished, { why: 'interrupted', at: BEAT, n: 2, of: 3, left: 2 });
    const run = JSON.parse(fs.readFileSync(research.runFile(lib.home), 'utf8'));
    assert.equal(run.ended, BEAT, 'ended at its last heartbeat');
    assert.ok(Date.parse(run.interrupted) > Date.parse(BEAT), 'and when she noticed');
    const own = stage.readOwn(stage.stageFile(lib.home));
    assert.equal(own.stage, 'idle', 'her desk no longer shows the dead run');
    assert.equal((await sv.req('GET', '/api/stage')).body.stage, 'idle');

    // A plain start waits: the stopped run is picked up first.
    const plain = await sv.post('/api/research', {});
    assert.equal(plain.status, 409);
    assert.equal(plain.body.reason, 'interrupted');

    const r = await sv.post('/api/research/resume', { list: ['Something else'] });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.resumed, 2);
    assert.ok(await waitFor(() => fs.existsSync(path.join(fake5.dir, 'argv.json'))), 'the fake ran');
    assert.deepEqual(fake5.argv().argv, research.ARGS(lib.home, lib.root), 'the same fixed arguments');
    // The run's own first step (take) gets exactly the two topics it left, word for word; her newer request waits.
    const taken = requests.take(requests.queueFile(lib.home));
    const got = requests.list(taken);
    assert.deepEqual(got.map((q) => [q.topic, q.framing, q.at]), [
      ['Rain barrels', 'Two downpipes.\n# not a heading', '2026-10-08T20:01:00.000Z'],
      ['Sourdough starter care', '', '2026-10-08T20:02:00.000Z'],
    ]);
    assert.deepEqual(requests.list(requests.queueFile(lib.home)).map((q) => q.topic), ['No question just you stalled out']);
    const now = (await sv.req('GET', '/api/research')).body;
    assert.equal(now.running, true);
    assert.equal(now.unfinished, null, 'the offer is gone while the new run works');

    // Stopped with Stop, the new run's leftovers are offered too, and a plain start is not held back.
    assert.equal((await sv.post('/api/research/stop', {})).status, 200);
    const after = (await sv.req('GET', '/api/research')).body;
    assert.deepEqual([after.unfinished.why, after.unfinished.n, after.unfinished.of, after.unfinished.left], ['stopped', 1, 2, 2]);
  } finally {
    try { await sv.post('/api/research/stop', {}); } catch (_) { /* stopped already */ }
    await new Promise((res) => sv.server.close(res));
  }
});

test('a run is never called interrupted while its runner beats or its program still works; with nothing left, nothing is offered', async () => {
  const quiet = diedMidRun(await deadPid(), process.pid);
  const runFile = research.runFile(quiet.home);
  const base = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const opts = { home: quiet.home, roots: quiet.roots, writeRoot: quiet.root, claude: fake.file };
  // A heartbeat a moment ago: her runner is there.
  fs.writeFileSync(runFile, JSON.stringify(Object.assign({}, base, { beat: new Date().toISOString() })));
  assert.equal(research.notice(opts), null);
  assert.equal(JSON.parse(fs.readFileSync(runFile, 'utf8')).ended, undefined);
  // An old heartbeat, but the program it started is still working (this test's own Node stands in for it).
  fs.writeFileSync(runFile, JSON.stringify(Object.assign({}, base, { pid: process.pid, image: path.basename(process.execPath) })));
  assert.equal(research.notice(opts), null);
  assert.equal(research.status(opts).unfinished, null);
  assert.equal(JSON.parse(fs.readFileSync(runFile, 'utf8')).ended, undefined, 'never marked');
  // Gone, but every topic was done before it stopped: it is marked, and nothing is offered.
  write(path.join(quiet.root, '2026-10-08-rain-barrels', 'meta.json'), JSON.stringify({ title: 'Rain barrels', status: 'complete' }));
  write(path.join(quiet.root, 'failed', '2026-10-08-sourdough-starter-care.md'), '# FAILED — Sourdough starter care\n');
  fs.writeFileSync(runFile, JSON.stringify(Object.assign({}, base, { pid: await deadPid() })));
  assert.ok(research.notice(opts));
  assert.ok(JSON.parse(fs.readFileSync(runFile, 'utf8')).interrupted);
  assert.equal(research.status(opts).unfinished, null);
  assert.equal((await research.resume(opts).catch((e) => e)).reason, 'nothing-left');
});

/** fn run with tasklist (ps elsewhere) out of reach, so no pid's program can be read: a tasklist that timed out. */
function blind(fn) {
  const was = process.env.PATH;
  process.env.PATH = '';
  try { return fn(); } finally { process.env.PATH = was; }
}

/** A pid that stays alive (a Node, waiting) until the tests end. */
function livePid() {
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(c);
  return c.pid;
}

test('a live pid whose program cannot be read (a tasklist hiccup) is never taken for gone: no interruption, no second run', async () => {
  const pid = livePid();
  const lib = diedMidRun(await deadPid(), pid); // its runner (a Node, as runners are) is alive; its program is gone
  const opts = { home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake.file, launch: fakeLaunch };
  const file = research.runFile(lib.home);
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(blind(() => research.imageOf(pid)), null, 'nothing can be read');
  assert.equal(blind(() => research.notice(opts)), null, 'its runner is alive');
  // Its runner gone, the program it started alive under the same pid: unread, it is still her run.
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, base, { runner: await deadPid(), pid })));
  assert.equal(blind(() => research.notice(opts)), null, 'its program is alive');
  assert.equal(blind(() => research.status(opts)).unfinished, null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ended, undefined, 'never marked');
  // Read again, that pid is a Node, not the claude.exe she started: now the run did stop, and it is offered.
  assert.ok(research.notice(opts));
  assert.equal(research.status(opts).unfinished.why, 'interrupted');

  // A run going (its heartbeat fresh): start cannot read its program either, and does not start a second run.
  const busy = diedMidRun(await deadPid(), pid);
  const bf = research.runFile(busy.home);
  fs.writeFileSync(bf, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(bf, 'utf8')), { pid, beat: new Date().toISOString() })));
  const b = { home: busy.home, roots: busy.roots, writeRoot: busy.root, claude: fake.file, launch: fakeLaunch };
  assert.equal((await blind(() => research.start(b)).catch((e) => e)).reason, 'running');
  assert.equal(JSON.parse(fs.readFileSync(bf, 'utf8')).token, 'dead', 'nothing was started');
});

test('a run Claude Code ended with an error (the usage limit, say) offers what it left, once; Stop\'s record and a clean end are kept', async () => {
  const ENDED = '2026-10-09T01:31:00.000Z';
  const lib = diedMidRun(await deadPid(), process.pid);
  const file = research.runFile(lib.home);
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const opts = { home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake.file };
  // Her runner saw the program exit with code 1 and wrote that it ended. Nobody pressed Stop; nothing was interrupted.
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, base, { beat: ENDED, ended: ENDED, code: 1, signal: null })));
  const at = (iso) => Object.assign({}, opts, { now: Date.parse(iso) });
  assert.deepEqual(research.status(at('2026-10-09T02:00:00Z')).unfinished, { why: 'ended-early', at: ENDED, n: 2, of: 3, left: 2 });
  const once = fs.readFileSync(research.leftFile(lib.home), 'utf8');
  assert.deepEqual(research.status(at('2026-10-09T03:00:00Z')).unfinished, { why: 'ended-early', at: ENDED, n: 2, of: 3, left: 2 });
  assert.equal(fs.readFileSync(research.leftFile(lib.home), 'utf8'), once, 'recorded once, not on every look');

  const fake6 = makeFake();
  const sv = await serve({ home: lib.home, roots: lib.roots, writeRoot: lib.root, claude: fake6.file, launch: fakeLaunch });
  try {
    assert.equal((await sv.post('/api/research', {})).body.reason, 'interrupted', 'a plain start waits, as after an interruption');
    const r = await sv.post('/api/research/resume', {});
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.resumed, 2);
    assert.deepEqual(requests.list(requests.resumeFile(lib.home)).map((q) => q.topic), ['Rain barrels', 'Sourdough starter care']);
  } finally {
    try { await sv.post('/api/research/stop', {}); } catch (_) { /* stopped already */ }
    await new Promise((res) => sv.server.close(res));
  }

  // The runner's last write (code 1 from the kill) can land after Stop's: Stop's own record stands.
  const lib2 = diedMidRun(await deadPid(), process.pid);
  const file2 = research.runFile(lib2.home);
  const base2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
  const opts2 = { home: lib2.home, roots: lib2.roots, writeRoot: lib2.root, claude: fake.file };
  fs.writeFileSync(file2, JSON.stringify(Object.assign({}, base2, { ended: ENDED, code: 1 })));
  write(research.leftFile(lib2.home), JSON.stringify({ token: 'dead', why: 'stopped', at: ENDED, noticed: ENDED, list: 'queue-2026-10-08T23-00-05-000Z.md', n: 2, of: 3, left: [1, 2] }));
  assert.deepEqual(research.status(opts2).unfinished, { why: 'stopped', at: ENDED, n: 2, of: 3, left: 2 });
  // A clean end (code 0) is not an early one: nothing is recorded or offered.
  fs.rmSync(research.leftFile(lib2.home));
  fs.writeFileSync(file2, JSON.stringify(Object.assign({}, base2, { ended: ENDED, code: 0 })));
  assert.equal(research.status(opts2).unfinished, null);
  assert.equal(fs.existsSync(research.leftFile(lib2.home)), false);
});

test('the permission flags are exactly these (a literal list: widening any of them fails here)', () => {
  const args = research.ARGS('HOME', 'LIBRARY');
  assert.deepEqual(args, [
    '-p', 'Louise, research my list.',
    '--append-system-prompt', "Louise's dashboard started this session. Nobody is at the keyboard and nobody can answer a question. Follow the section of her CLAUDE.md headed: A run started from her dashboard.",
    '--setting-sources', 'project,local',
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--add-dir', 'LIBRARY',
    '--allowedTools', 'WebSearch', 'WebFetch', 'Agent', 'Skill',
    'Bash(node engine/config.js)', 'Bash(node engine/config.js *)', 'Bash(node engine/requests.js *)',
    'Bash(node engine/stage.js *)', 'Bash(node engine/library.js *)', 'Bash(node engine/fetch.js *)',
    'Bash(node engine/run-state.js *)', 'Bash(node engine/check-citations.js *)',
    '--disallowedTools', 'AskUserQuestion', 'CronCreate',
    'Edit(engine/**)', 'Edit(dashboard/**)', 'Edit(CLAUDE.md)', 'Edit(subagent.md)', 'Edit(agent.json)',
    'Edit(package.json)', 'Edit(.claude/**)', 'Edit(.git/**)', 'Edit(.gitignore)', 'Edit(louise.config.json)',
    'Edit(state/run-tmp/**)', 'Edit(CLAUDE.local.md)', 'Edit(.mcp.json)',
  ]);
  const joined = args.join('\n');
  for (const never of ['run-tmp/*)', 'dangerously', 'bypassPermissions', 'Bash(node state', 'Bash(*', 'Bash)', '"']) {
    assert.ok(!joined.includes(never), never);
  }
  assert.ok(!args.includes('Bash') && !args.includes('Edit') && !args.includes('Write'), 'no bare Bash, Edit or Write');
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  for (const a of allowed.filter((x) => x.startsWith('Bash('))) {
    const m = /^Bash\(node engine\/([a-z-]+)\.js( \*)?\)$/.exec(a);
    assert.ok(m, a);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'engine', `${m[1]}.js`)), `${a} names a script that ships`);
  }
});

test('the real detached start runs the fake through engine/research-run.js, and stop ends it', async (t) => {
  const lib3 = makeLibrary();
  const fake3 = makeFake();
  requests.add(requests.queueFile(lib3.home), { topic: 'Sourdough starter care' });
  const sv = await serve({ home: lib3.home, roots: lib3.roots, writeRoot: lib3.root, claude: fake3.file });
  t.after(async () => {
    try { await sv.post('/api/research/stop', {}); } catch (_) { /* stopped already */ }
    await new Promise((r) => sv.server.close(r));
  });
  const r = await sv.post('/api/research', {});
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.ok(await waitFor(() => fs.existsSync(path.join(fake3.dir, 'argv.json'))), 'the fake ran');
  assert.deepEqual(fake3.argv().argv, research.ARGS(lib3.home, lib3.root));
  const run = JSON.parse(fs.readFileSync(research.runFile(lib3.home), 'utf8'));
  assert.equal(run.pid, r.body.pid);
  assert.notEqual(run.runner, process.pid, 'the runner is its own process');
  assert.equal((await sv.post('/api/research', {})).body.reason, 'running');
  assert.equal((await sv.post('/api/research/stop', {})).status, 200);
  assert.ok(await waitFor(() => !alive(run.pid)));
  assert.ok(await waitFor(() => Boolean(JSON.parse(fs.readFileSync(research.runFile(lib3.home), 'utf8')).ended)), 'the runner marked the run ended');
  assert.match(fs.readFileSync(research.logFile(lib3.home), 'utf8'), /Starting a research run/);
});
