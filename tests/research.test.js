'use strict';

/**
 * research.test.js — engine/research.js and the dashboard's research routes. Never real Claude Code: a harmless fake
 * program in a temporary folder records the arguments it was given, then waits to be stopped.
 *
 * The routes refuse a foreign Host, a cross-site page and a form POST; an empty list; a second start while a run is
 * going. A run gets only the fixed arguments, whatever the request body says. Stop acts only on the pid it recorded:
 * a pid named in the body is ignored, a run file whose pid is now another program is not trusted, nor is one whose
 * runner has gone quiet. findClaude reads npm's .cmd shim for the program it names, and never falls back to cmd.exe.
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
  assert.deepEqual(st.body, { running: false, since: null, waiting: 0, claude: true });

  const lib2 = makeLibrary();
  requests.add(requests.queueFile(lib2.home), { topic: 'Frost dates for raised beds' });
  const none = await serve({ home: lib2.home, roots: lib2.roots, writeRoot: lib2.root, claude: path.join(lib2.home, 'no-such-claude.exe'), launch: fakeLaunch });
  const nc = await none.post('/api/research', {});
  assert.equal(nc.status, 409);
  assert.equal(nc.body.reason, 'no-claude');
  assert.match(nc.body.error, /^I need Claude Code on this computer to do research\./);
  assert.equal((await none.req('GET', '/api/research')).body.claude, false);
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
  // On the PATH it is skipped (a Claude Code in ~/.local/bin may still be found; never cmd.exe, never the shim).
  const found = research.findClaude({ env: { PATH: path.dirname(unread) }, platform: 'win32' });
  assert.ok(!found || (found.program !== unread && !/cmd\.exe$/i.test(found.program)));
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
    'Edit(state/run-tmp/**)',
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
