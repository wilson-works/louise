'use strict';

/**
 * engine/research-run.js — the runner for one research run started from Louise's dashboard (engine/research.js
 * starts it detached; on Windows through engine/detach.vbs, so it holds none of the server's handles). Node built-ins
 * only.
 *
 *   node engine/research-run.js <job file>
 *
 * The job file (state/research-job.json, written by research.js) holds { token, cwd, log, runFile, stateFile,
 * program, args, image, cmdLine } and nothing else: no environment, which this runner inherits instead.
 * It starts the program with its output appended to the log, in its own process group, and keeps the run file:
 *   { token, pid, runner, image, program, started, beat }   the heartbeat (beat) every 10 seconds while it runs
 *   + { ended, code, signal }                               when the program exits
 * When the program exits and her stage is not idle (it stopped early, or the runbook did not finish), her stage goes
 * to idle with a plain note, so her desk never shows her working on a run that has gone. Exit code: 0.
 */

const fs = require('fs');
const { spawn } = require('child_process');
const stage = require('./stage');

const BEAT_MS = 10 * 1000;

function main() {
  let job;
  try { job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { return; }
  const note = (m) => { try { fs.appendFileSync(job.log, `[${new Date().toISOString()}] ${m}\n`); } catch (_) { /* no log */ } };
  const write = (obj) => {
    const tmp = `${job.runFile}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`); fs.renameSync(tmp, job.runFile); } catch (_) {
      try { fs.writeFileSync(job.runFile, `${JSON.stringify(obj, null, 2)}\n`); fs.rmSync(tmp, { force: true }); } catch (__) { /* nothing more to do */ }
    }
  };
  const record = { token: job.token, pid: null, runner: process.pid, image: job.image, program: job.program, started: new Date().toISOString(), beat: null };

  let child;
  let out;
  try {
    out = fs.openSync(job.log, 'a');
    note(`Starting a research run: ${job.program}`);
    const cmd = Boolean(job.cmdLine);
    child = spawn(job.program, cmd ? [job.cmdLine] : job.args, {
      cwd: job.cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true, windowsVerbatimArguments: cmd,
    });
  } catch (e) {
    note(`The research run could not start: ${e.message}`);
    write(Object.assign(record, { ended: new Date().toISOString(), error: e.message }));
    return;
  } finally {
    if (out != null) fs.closeSync(out);
  }

  let done = false;
  const finish = (code, signal, error) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    write(Object.assign(record, { beat: new Date().toISOString(), ended: new Date().toISOString(), code, signal, error: error || undefined }));
    note(error ? `The research run could not start: ${error}` : `The research run ended (exit code ${code == null ? signal : code}).`);
    try {
      const own = stage.readOwn(job.stateFile);
      if (own && own.stage !== 'idle') {
        stage.set(job.stateFile, 'idle', { note: code === 0 ? 'The research run ended.' : 'The research run stopped before it finished. The details are in state/research.log.' });
      }
    } catch (_) { /* her stage is a nicety here */ }
  };
  let timer = null;
  child.on('error', (e) => finish(null, null, e.message));
  child.on('exit', (code, signal) => finish(code, signal));
  if (!child.pid) return;
  record.pid = child.pid;
  record.beat = new Date().toISOString();
  write(record);
  timer = setInterval(() => { record.beat = new Date().toISOString(); write(record); }, BEAT_MS);
}

main();
