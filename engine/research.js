'use strict';

/**
 * engine/research.js — start and stop one research run of Louise's list from her dashboard. Node built-ins only.
 *
 * A run is Claude Code, headless, in her folder (so her CLAUDE.md loads), told "Louise, research my list." Nothing
 * from a request goes into it: the program comes from louise.config.json or the PATH, and the arguments are fixed
 * here. Only her folder and her library folder change from one computer to another.
 *
 * Finding Claude Code (findClaude):
 *   1. "claude" in louise.config.json (a path; it wins, so a person can point her at the one they want).
 *   2. On the PATH: claude.exe, then claude.cmd (npm's shim) on Windows; claude elsewhere. Then ~/.local/bin, where
 *      the native installer puts it, for a dashboard started without the person's PATH.
 *   3. On Windows, npm's own folder, for an office started without npm on its PATH: %APPDATA%\npm\claude.cmd, then the
 *      claude.exe under %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin.
 *   4. The newest Claude Code extension for VS Code: ~/.vscode/extensions/anthropic.claude-code-<version>-<platform>/
 *      resources/native-binary/claude (claude.exe on Windows). Versions are compared number by number, so 2.1.295 is
 *      newer than 2.1.95; a folder without the program is passed over.
 *   A .cmd shim is read for the program it starts ("%dp0%\...\claude.exe" or a .js entry script) and that program is
 *   run directly. A shim that names no such program is not used: nothing is ever run through cmd.exe or a shell. Name
 *   the program in louise.config.json instead. A .js file runs with this Node; anything else runs as it is.
 *   status() says where she found it, in plain words (claudeFrom), or where she looked.
 *
 * The headless flags (ARGS), the narrowest set that lets her runbook run unattended:
 *   --setting-sources project,local    the person's own ~/.claude/settings.json is not read, so their allow rules and
 *                                      hooks do not widen this list (measured on 2.1.263: python -c and npm run, both
 *                                      allowed in a user settings file, are refused). That also leaves out the skills
 *                                      in ~/.claude/skills, so before each run engine/skills.js copies the skills her
 *                                      agent.json requires into her folder's .claude/skills, where they load as project
 *                                      skills; a run cannot write there.
 *   -p "Louise, research my list."     print mode: one session, no keyboard, ends when the runbook ends
 *   --append-system-prompt <fixed>     tells the session her dashboard started it, so CLAUDE.md's "A run started from
 *                                      her dashboard" rules apply (nobody to ask; the button was the yes)
 *   --permission-mode acceptEdits      file edits are accepted only inside the working folders: her folder (the cwd)
 *   --add-dir <the library>            and her library, where new research is written. Nothing else is writable.
 *   --permission-prompts none          anything not allowed below is refused at once, never waits for a person
 *   --allowedTools                     WebSearch, WebFetch (the research itself); Agent (the skills' scope checker,
 *                                      deep researcher, readers and distillers are subagents); Skill (marathon-
 *                                      research, marathon-research-council, distill); and Bash only for her own
 *                                      shipped scripts (ALLOWED_SCRIPTS), including run-state.js (the skill's state
 *                                      file) and check-citations.js (its citation check), so the run never has to
 *                                      write a script and execute it.
 *   --disallowedTools                  AskUserQuestion (nobody is there to answer); CronCreate (a loop that outlives
 *                                      this session would wake with nobody watching); and Edit on every file that is
 *                                      code or configuration in her folder (DENY_EDIT), so the scripts allowed above
 *                                      stay the shipped ones. A deny beats an allow and beats acceptEdits; an Edit
 *                                      rule covers every file-writing tool (2.1.263 matches no Write(path) rule). The
 *                                      run can write only her list and state data, and the library.
 * Not given: --dangerously-skip-permissions, bypassPermissions, any bare Bash, Edit or Write rule, any other folder,
 * and no rule that runs a script the session could have written. A web page the run reads can still steer what it
 * writes in the library and which of these tools it calls.
 *
 * The library folder is made before the run starts: --add-dir names a working folder only when it is there.
 *
 * Starting (start): refused when Claude Code is not found (409 no-claude), there is no library folder (409
 * no-library), her list is empty (409 empty), a run is going (409 running) or a skill her runbook needs is installed
 * nowhere (409 no-skill). Otherwise it copies her skills in (engine/skills.js), writes a job file and starts
 * engine/research-run.js detached, with no handle of the server's (on Windows through engine/detach.vbs and
 * WScript.Shell.Run, because a child started by Node inherits every inheritable handle, and a server whose output is
 * captured would be held open by it). The runner starts Claude Code with its output in state/research.log, keeps
 * state/research-run.json (its pid, the program's image name, a heartbeat every 10 s) and marks it ended when the
 * program exits.
 *
 * Is a run going (current): the run file is there, not ended, its heartbeat is under a minute old, the recorded pid is
 * alive, and (checked for start and stop) that pid is still the program that was started (its image name). A run file
 * whose runner has gone quiet is not trusted: stop never acts on a pid it cannot vouch for.
 * Stopping (stop): only the recorded pid, and its children: taskkill /PID <pid> /T /F on Windows, the process group
 * elsewhere. Her stage goes to idle with a plain note. Nothing in a request names a pid.
 *
 * A run that stopped before it finished (notice, on every status and start): the run file says a run is going, its
 * heartbeat is over a minute old, its runner is gone (that pid is not alive, is this server, or is now some other
 * program than Node) and so is the program it started (not alive, or now another program). Such a run was
 * interrupted (the office restarted, the computer shut down): the run file is marked ended at its last heartbeat, with
 * "interrupted" set to when she noticed; her stage goes to idle; and state/research-left.json records the topics it
 * did not finish (engine/resume.js has the rule: a finished topic has its meta.json). A run stopped with Stop records
 * the same. While that record is the last run's and names a topic left, status says so (unfinished), and a plain
 * start is refused after an interruption (409 interrupted): "Pick up where I left off" (resume) comes first.
 * Picking up (resume): the left topics, word for word with their request times and in their order, are written to
 * requests/resume.md, which the run's own `take` takes before her list (engine/requests.js); then a run starts as
 * above, with the same fixed arguments. Requests added since stay on her list for the run after.
 *
 *   findClaude({ claude, env, platform, homeDir })  { program, args, image, via, from, version } or null
 *   ALLOWED_SCRIPTS, DENY_EDIT                     the scripts a run may execute, the paths it may never write
 *   ARGS(home, library)                            the fixed arguments
 *   status(opts)  start(opts)  stop(opts)  resume(opts)
 *                                                  opts { home, roots, writeRoot, claude, launch, hub, homeDir, now }
 *                                                  (hub, homeDir: where skills.js looks, for tests)
 *   notice(opts)                                   marks an interrupted run as above; returns its run file or null
 *   runFile(home), logFile(home), leftFile(home)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const requests = require('./requests');
const stage = require('./stage');
const skills = require('./skills');
const pickup = require('./resume');
const { findHub } = require('./config');

const PROMPT = 'Louise, research my list.';
const SYSTEM_NOTE = "Louise's dashboard started this session. Nobody is at the keyboard and nobody can answer a question. " +
  'Follow the section of her CLAUDE.md headed: A run started from her dashboard.';
const BEAT_MS = 10 * 1000;
const STALE_BEAT_MS = 60 * 1000;
const STARTING_MS = 30 * 1000;
// Set by a Claude Code session in the programs it starts. A run started from her dashboard is its own session, not
// part of whichever session started the dashboard, so these are not passed on. Everything else in the environment is.
const SESSION_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION'];

const runFile = (home) => path.join(home, 'state', 'research-run.json');
const logFile = (home) => path.join(home, 'state', 'research.log');
const jobFile = (home) => path.join(home, 'state', 'research-job.json');
const leftFile = (home) => path.join(home, 'state', 'research-left.json');
const refuse = (status, reason, message) => Object.assign(new Error(message), { status, reason });

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } }
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8'); fs.rmSync(tmp, { force: true }); }
}

// The only commands a run may execute: her own shipped scripts, run from her folder.
const ALLOWED_SCRIPTS = ['config', 'requests', 'stage', 'library', 'fetch', 'run-state', 'check-citations'];
// Paths in her folder a run may never write (relative to her folder, the run's working folder).
const DENY_EDIT = ['engine/**', 'dashboard/**', 'CLAUDE.md', 'subagent.md', 'agent.json', 'package.json', '.claude/**',
  '.git/**', '.gitignore', 'louise.config.json', 'state/run-tmp/**', 'CLAUDE.local.md', '.mcp.json'];

/** The fixed arguments for a run. Only her library folder varies, and it comes from her own config. */
function ARGS(home, library) {
  return [
    '-p', PROMPT,
    '--append-system-prompt', SYSTEM_NOTE,
    '--setting-sources', 'project,local',
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--add-dir', library,
    '--allowedTools', 'WebSearch', 'WebFetch', 'Agent', 'Skill', 'Bash(node engine/config.js)',
    ...ALLOWED_SCRIPTS.map((n) => `Bash(node engine/${n}.js *)`),
    '--disallowedTools', 'AskUserQuestion', 'CronCreate',
    ...DENY_EDIT.map((d) => `Edit(${d})`),
  ];
}

/** How to start a program file: a .js with this Node, a .cmd shim through the program it names, else directly. */
function launcher(file, platform) {
  const ext = path.extname(file).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(ext)) return { program: process.execPath, args: [file], image: path.basename(process.execPath), via: file };
  if (ext === '.cmd' || ext === '.bat') {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
    // npm's shim: "%dp0%\node_modules\...\claude.exe" %*   (or "%_prog%" "%dp0%\...\cli.js" %* in older ones)
    const named = [...text.matchAll(/"%dp0%\\([^"%]+\.(?:exe|js|cjs|mjs))"/gi)].map((m) => path.join(path.dirname(file), m[1]));
    const target = named.reverse().find(isFile);
    if (target) { const l = launcher(target, platform); if (l) return Object.assign(l, { via: file }); }
    return null; // a shim that names no program is never run through cmd.exe: name the program in louise.config.json
  }
  return { program: file, args: [], image: path.basename(file), via: file };
}

/** Number by number: 2.1.295 is newer than 2.1.95. Negative when a is older than b. */
function compareVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** The program in the newest anthropic.claude-code-<version>[-<platform>] folder under dir that has one, or null. */
function newestExtension(dir, name) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return null; }
  const found = names.map((n) => { const m = /^anthropic\.claude-code-(\d+(?:\.\d+)*)(?:-.+)?$/i.exec(n); return m ? { n, version: m[1] } : null; })
    .filter(Boolean)
    .sort((a, b) => compareVersions(b.version, a.version) || a.n.localeCompare(b.n));
  for (const e of found) {
    const file = path.join(dir, e.n, 'resources', 'native-binary', name);
    if (isFile(file)) return { file, version: e.version };
  }
  return null;
}

/**
 * Claude Code on this computer: the configured path, else the PATH, else ~/.local/bin, else (Windows) npm's folder,
 * else the newest VS Code extension. Null when it is not found. from says which: config, path, local-bin, npm, vscode.
 */
function findClaude(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const homeDir = o.homeDir || os.homedir();
  const from = (l, where, extra) => (l ? Object.assign(l, { from: where }, extra) : null);
  if (o.claude) return isFile(o.claude) ? from(launcher(path.resolve(o.claude), platform), 'config') : null;
  const env = o.env || process.env;
  const onPath = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const dirs = onPath.concat(path.join(homeDir, '.local', 'bin'));
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const name of names) {
    for (let i = 0; i < dirs.length; i += 1) {
      const f = path.join(dirs[i].replace(/^"|"$/g, ''), name);
      if (isFile(f)) { const l = launcher(f, platform); if (l) return from(l, i < onPath.length ? 'path' : 'local-bin'); }
    }
  }
  if (platform === 'win32') {
    const npm = path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm');
    for (const f of [path.join(npm, 'claude.cmd'), path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')]) {
      if (isFile(f)) { const l = launcher(f, platform); if (l) return from(l, 'npm'); }
    }
  }
  const ext = newestExtension(path.join(homeDir, '.vscode', 'extensions'), platform === 'win32' ? 'claude.exe' : 'claude');
  return ext ? from(launcher(ext.file, platform), 'vscode', { version: ext.version }) : null;
}

/** Where she found Claude Code, in plain words: for her status, so a person can see which program a run would use. */
function claudeFrom(found, configured) {
  if (found && typeof found === 'object') {
    const where = {
      config: 'Named in louise.config.json', path: 'Found on the PATH', 'local-bin': 'Found in ~/.local/bin',
      npm: "Found in npm's folder", vscode: `Found in the Claude Code extension for VS Code${found.version ? `, version ${found.version}` : ''}`,
    }[found.from] || 'Found';
    return `${where}: ${found.via || found.program}`;
  }
  if (configured) return `louise.config.json names ${configured} as Claude Code, but there is no program there.`;
  return "Not found. I looked in louise.config.json, on the PATH, in ~/.local/bin, in npm's folder and in the VS Code extension.";
}

/** The image name of a running pid ("claude.exe", "node"), or null when there is no such process. */
function imageOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /^"([^"]+)","(\d+)"/m.exec(out);
      return m && Number(m[2]) === pid ? m[1] : null;
    }
    const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).trim();
    return out ? path.basename(out) : null;
  } catch (_) { return null; }
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const sameImage = (a, b) => {
  const x = String(a || '').toLowerCase().replace(/\.exe$/, '');
  const y = String(b || '').toLowerCase().replace(/\.exe$/, '');
  return Boolean(x && y) && (x === y || (x.length >= 15 && y.startsWith(x)) || (y.length >= 15 && x.startsWith(y)));
};

/**
 * The run that is going, or null. { pid, image, started, starting } . `strict` also checks the pid is still the program
 * that was started (one tasklist or ps call), as start and stop do.
 */
function current(home, strict, now) {
  const at = now || Date.now();
  const r = readJson(runFile(home));
  if (!r || typeof r !== 'object' || r.ended) return null;
  if (r.starting) return at - Date.parse(r.at) < STARTING_MS ? { starting: true, started: r.at, pid: null } : null;
  if (!(at - Date.parse(r.beat) < STALE_BEAT_MS)) return null;
  if (!alive(r.pid)) return null;
  if (strict && !sameImage(imageOf(r.pid), r.image)) return null;
  return { pid: r.pid, image: r.image, started: r.started, starting: false };
}

/** The runner (engine/research-run.js, run by this Node) is gone: not alive, this server's own pid, or another program. */
function runnerGone(r) {
  if (!Number.isInteger(r.runner) || r.runner === process.pid || !alive(r.runner)) return true;
  return !sameImage(imageOf(r.runner), path.basename(process.execPath));
}

/**
 * The topics the run in this run file left unfinished (engine/resume.js), recorded in state/research-left.json as
 * { token, why: interrupted|stopped, at, noticed, list, n, of, left }. Nothing is recorded when it took no list.
 */
function recordLeft(o, r, why, at) {
  if (!o.writeRoot || !r || !r.token || !r.started) return null;
  let pick = null;
  try {
    const list = pickup.takenList(o.home, r.started, at);
    pick = list ? pickup.leftovers({ home: o.home, started: r.started, list, roots: o.roots, writeRoot: o.writeRoot }) : null;
  } catch (_) { pick = null; }
  if (!pick) return null;
  const rec = { token: r.token, why, at, noticed: new Date(o.now || Date.now()).toISOString(), list: pick.list, n: pick.n, of: pick.of, left: pick.left };
  writeJson(leftFile(o.home), rec);
  return rec;
}

/** What the last run left to pick up, while it is the run in her run file and has ended: the record, or null. */
function lastLeft(home) {
  const r = readJson(runFile(home));
  const l = readJson(leftFile(home));
  if (!r || !l || typeof l !== 'object' || !r.ended || !l.token || l.token !== r.token) return null;
  if (!['interrupted', 'stopped'].includes(l.why) || !pickup.LIST_RE.test(String(l.list))) return null;
  if (!Number.isInteger(l.of) || !Number.isInteger(l.n) || !Array.isArray(l.left) || !l.left.length) return null;
  return l.left.every((i) => Number.isInteger(i) && i >= 0 && i < l.of) ? l : null;
}

/** A run that stopped without saying so (its runner and its program are gone): marked ended, its leftovers recorded. */
function notice(opts) {
  const o = opts || {};
  const r = readJson(runFile(o.home));
  if (!r || typeof r !== 'object' || r.ended || r.starting || !Number.isInteger(r.pid)) return null;
  const at = o.now || Date.now();
  if (at - Date.parse(r.beat) < STALE_BEAT_MS) return null; // the runner wrote its heartbeat a moment ago
  if (!runnerGone(r)) return null;
  if (alive(r.pid) && sameImage(imageOf(r.pid), r.image)) return null; // the program is still working
  const last = r.beat || r.started;
  writeJson(runFile(o.home), Object.assign({}, r, { ended: last, interrupted: new Date(at).toISOString() }));
  recordLeft(o, r, 'interrupted', last);
  const file = stage.stageFile(o.home);
  const own = stage.readOwn(file);
  if (!own || own.stage !== 'idle') stage.set(file, 'idle', { note: 'My last research run stopped before I finished.' });
  return r;
}

/** What her dashboard needs: is a run going, how many questions wait, can one start, did the last one stop early. */
function status(opts) {
  const o = opts || {};
  notice(o);
  const run = current(o.home, false, o.now);
  const found = o.claudeFound != null ? o.claudeFound : findClaude({ claude: o.claude });
  const left = run ? null : lastLeft(o.home);
  return {
    running: Boolean(run), since: run ? run.started : null,
    waiting: requests.list(requests.queueFile(o.home)).length,
    claude: Boolean(found),
    claudeFrom: claudeFrom(found, o.claude),
    unfinished: left ? { why: left.why, at: left.at, n: left.n, of: left.of, left: left.left.length } : null,
  };
}

/** This environment without the calling Claude Code session's own variables (never written to a file). */
const runEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_ENV.includes(k.toUpperCase())));

/** Start the runner detached, with nothing of ours. The job file holds paths and arguments only, never the environment. */
function launchDetached(job, home) {
  const runner = path.join(__dirname, 'research-run.js');
  const jf = jobFile(home);
  writeJson(jf, job);
  const env = runEnv();
  if (process.platform === 'win32') {
    const vbs = path.join(__dirname, 'detach.vbs');
    const w = spawn('wscript.exe', ['//B', '//Nologo', vbs, process.execPath, runner, jf], { cwd: home, env, detached: true, stdio: 'ignore', windowsHide: true });
    w.on('error', () => { /* seen below: the run file never appears */ });
    w.unref();
    return;
  }
  const c = spawn(process.execPath, [runner, jf], { cwd: home, env, detached: true, stdio: 'ignore' });
  c.on('error', () => { /* seen below */ });
  c.unref();
}

/**
 * Start one run. Resolves { running: true, pid } once the runner has started the program, or throws an error with
 * .status and .reason. opts { home, roots, writeRoot, claude, launch (job, home) for tests, waitMs }.
 */
async function start(opts) {
  const o = opts || {};
  const home = o.home;
  notice(o);
  const found = findClaude({ claude: o.claude });
  if (!found) throw refuse(409, 'no-claude', 'I need Claude Code on this computer to do research. Install it, or name its program in louise.config.json as "claude".');
  if (!o.writeRoot) throw refuse(409, 'no-library', 'I have no library folder yet. Name one in louise.config.json, then try again.');
  const left = o.resume ? null : lastLeft(home);
  if (left && left.why === 'interrupted') throw refuse(409, 'interrupted', 'My last run stopped partway. Press "Pick up where I left off" first.');
  if (!requests.list(requests.queueFile(home)).length && !requests.list(requests.resumeFile(home)).length) throw refuse(409, 'empty', 'Nothing on my list yet.');
  if (current(home, true)) throw refuse(409, 'running', "I'm already working on my list.");
  const have = skills.ensure({ home, hub: o.hub !== undefined ? o.hub : findHub(home), homeDir: o.homeDir });
  if (have.missing.length) {
    throw refuse(409, 'no-skill', `I need the ${have.missing[0]} skill installed to research. Install it in your Hub's .claude/skills or in ~/.claude/skills, then try again.`);
  }

  const token = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const args = ARGS(home, o.writeRoot);
  const job = {
    token, cwd: home, log: logFile(home), runFile: runFile(home), stateFile: stage.stageFile(home),
    program: found.program, args: found.args.concat(args), image: found.image,
  };
  fs.mkdirSync(o.writeRoot, { recursive: true }); // --add-dir names a working folder only when it is there
  writeJson(runFile(home), { starting: true, token, at: new Date().toISOString() });
  stage.set(stage.stageFile(home), 'researching', { note: 'Getting ready' });
  (o.launch || launchDetached)(job, home);

  const until = Date.now() + (o.waitMs || 15000);
  for (;;) {
    const r = readJson(runFile(home));
    if (r && r.token === token && r.pid) return { running: !r.ended, pid: r.pid };
    if (r && r.token === token && r.ended) break;
    if (Date.now() > until) break;
    await new Promise((res) => setTimeout(res, 150));
  }
  writeJson(runFile(home), { token, ended: new Date().toISOString(), error: 'did not start' });
  stage.set(stage.stageFile(home), 'idle', { note: 'The research run did not start. The details are in state/research.log.' });
  throw refuse(500, 'not-started', "I couldn't start the research run. The details are in my log, state/research.log.");
}

/** Stop the run she recorded, and only that one. */
function stop(opts) {
  const o = opts || {};
  const home = o.home;
  const run = current(home, true);
  if (!run) throw refuse(409, 'not-running', "I'm not working on my list right now.");
  if (run.starting) throw refuse(409, 'starting', "I'm only just starting. Try again in a moment.");
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(run.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
    else { try { process.kill(-run.pid, 'SIGTERM'); } catch (_) { process.kill(run.pid, 'SIGTERM'); } }
  } catch (_) { /* gone already, or partly: checked below */ }
  const r = readJson(runFile(home)) || {};
  if (!r.ended) writeJson(runFile(home), Object.assign(r, { ended: new Date().toISOString(), stopped: true }));
  stage.set(stage.stageFile(home), 'idle', { note: 'Stopped from her dashboard. What she finished is on the shelves.' });
  recordLeft(o, r, 'stopped', new Date().toISOString());
  return { running: alive(run.pid) && sameImage(imageOf(run.pid), run.image) };
}

/**
 * Pick up where she left off: one run over exactly the topics her last run did not finish (it was interrupted, or
 * stopped with Stop). Resolves as start does, with resumed: <how many topics>; throws 409 nothing-left when there are
 * none, and start's refusals otherwise.
 */
async function resume(opts) {
  const o = opts || {};
  const home = o.home;
  notice(o);
  if (current(home, true)) throw refuse(409, 'running', "I'm already working on my list.");
  const nothing = () => refuse(409, 'nothing-left', "There's nothing left from my last run to pick up.");
  const left = lastLeft(home);
  if (!left) throw nothing();
  const run = readJson(runFile(home));
  const pick = pickup.leftovers({ home, started: run.started, list: left.list, roots: o.roots, writeRoot: o.writeRoot });
  if (!pick || !pick.left.length) {
    writeJson(leftFile(home), Object.assign({}, left, { left: [] }));
    throw nothing();
  }
  const file = pickup.write(home, pick);
  try {
    return Object.assign(await start(Object.assign({}, o, { resume: true })), { resumed: pick.left.length });
  } catch (e) {
    // Not started: her last run is still the one to pick up. A runner that comes up late still takes the pick-up list.
    if (e && e.reason === 'not-started') writeJson(runFile(home), run);
    else fs.writeFileSync(file, requests.HEADER, 'utf8');
    throw e;
  }
}

module.exports = {
  PROMPT, ARGS, ALLOWED_SCRIPTS, DENY_EDIT, findClaude, claudeFrom, compareVersions, launcher, current, notice, status,
  start, stop, resume, runFile, logFile, jobFile, leftFile, imageOf, SESSION_ENV, BEAT_MS,
};
