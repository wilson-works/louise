'use strict';

/**
 * engine/stage.js — what Louise is doing right now: the one file that drives her animation. Node built-ins only.
 *
 * The file is state/louise.json in her folder:
 *   { "stage": "idle | researching | council | distill | shelving | fetching", "topic": "Frost dates for raised beds",
 *     "run": "research-2026-10-05T19-40", "step": { "n": 2, "of": 5 }, "since": "<ISO>", "updated": "<ISO>", "note": "..." }
 * "since" is when this stage (for this topic) began; "updated" is the last time anything was set.
 *
 * What the stage reads as (current), in order:
 *   1. A fetch lasts FETCH_MS (about six seconds), then the stage falls back to what it was before the fetch.
 *   2. A marathon-research wave marked in-progress, started after Louise last set her stage (or with no stage file at
 *      all), reads as researching that wave's topic. A wave or run counts only within the run's hours cap, so a
 *      session that died mid-wave does not keep her typing for ever.
 *   3. Her own stage, while it was set less than two hours ago (or it is idle).
 *   4. Stale, or no stage file: researching when a marathon-research state file says its run is going, else idle.
 *
 *   set(file, stage, opts, now)        write the stage; opts { topic, run, step: "n/of" or { n, of }, note }
 *   startFetch(file, info, now)        the stage goes to fetching for FETCH_MS, remembering what it was
 *   current(file, roots, now)          the stage as the dashboard shows it (rules above)
 *   readOwn(file), marathonState(roots), stageFile(home)
 *
 * CLI (from her folder):
 *   node engine/stage.js set <stage> [--topic "<topic>"] [--run <run>] [--step <n>/<of>] [--note "<words>"]
 *   node engine/stage.js get
 */

const fs = require('fs');
const path = require('path');

const STAGES = ['idle', 'researching', 'council', 'distill', 'shelving', 'fetching'];
const STALE_MS = 2 * 60 * 60 * 1000;
const FETCH_MS = 6000;
const DEFAULT_HOURS_CAP = 8;
const TEXT_MAX = 300;

const stageFile = (home) => path.join(home, 'state', 'louise.json');
const t = (iso) => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };
const iso = (ms) => new Date(ms).toISOString();
const clean = (s) => (s == null ? null : String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, TEXT_MAX) || null);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; }
}

/** Write a file so a reader never sees half of it: a temporary file, then a rename. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) {
    // Windows can refuse a rename over a file another process has open for a moment; write it directly then.
    fs.writeFileSync(file, text, 'utf8');
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* the temporary file only */ }
  }
}

/** Louise's own stage file, or null when it is missing or unreadable. */
function readOwn(file) {
  const s = readJson(file);
  return s && typeof s === 'object' && STAGES.includes(s.stage) ? s : null;
}

/** "2/5" or { n: 2, of: 5 } -> { n, of }; null when there is no step. Throws on a step it cannot read. */
function parseStep(step) {
  if (step == null || step === '') return null;
  let n;
  let of;
  if (typeof step === 'object') ({ n, of } = step);
  else {
    const m = /^\s*(\d+)\s*(?:\/|of)\s*(\d+)\s*$/.exec(String(step));
    if (!m) throw new Error(`The step "${step}" should look like 2/5 (step 2 of 5).`);
    n = Number(m[1]);
    of = Number(m[2]);
  }
  if (!Number.isInteger(n) || !Number.isInteger(of) || n < 0 || of < 1 || n > of) throw new Error(`The step ${n}/${of} does not add up: it should be a step from 0 to ${of}.`);
  return { n, of };
}

/** Set Louise's stage. Returns what was written. */
function set(file, stage, opts, now) {
  const o = opts || {};
  if (!STAGES.includes(stage)) throw new Error(`"${stage}" is not one of Louise's stages: ${STAGES.join(', ')}.`);
  const at = now || Date.now();
  if (stage === 'fetching') return startFetch(file, { title: o.topic, note: o.note }, at);
  const prev = readOwn(file);
  const topic = stage === 'idle' ? null : clean(o.topic);
  const same = prev && prev.stage === stage && (prev.topic || null) === topic;
  const next = {
    stage, topic, run: stage === 'idle' ? null : clean(o.run),
    step: stage === 'idle' ? null : parseStep(o.step),
    since: same && prev.since ? prev.since : iso(at), updated: iso(at), note: clean(o.note),
  };
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** The stage goes to fetching for FETCH_MS; it remembers the stage it was so it can go back to it. */
function startFetch(file, info, now) {
  const at = now || Date.now();
  let prior = readOwn(file);
  if (prior && prior.stage === 'fetching') prior = prior.prior || null;
  const i = info || {};
  const next = {
    stage: 'fetching', topic: clean(i.title || i.q), run: null, step: null, since: iso(at), updated: iso(at),
    note: clean(i.note), book: i.book || null, until: iso(at + FETCH_MS), prior,
  };
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** The newest readable marathon-research state file among the roots, with its file time, or null. */
function marathonState(roots) {
  let best = null;
  for (const r of roots || []) {
    if (!r || !r.state) continue;
    let st;
    try { st = fs.statSync(r.state); } catch (_) { continue; }
    if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;
    const s = readJson(r.state);
    if (s && typeof s === 'object' && (!best || st.mtimeMs > best.mtimeMs)) best = Object.assign({}, s, { mtimeMs: st.mtimeMs });
  }
  return best;
}

function view(s) {
  const out = { stage: s.stage, topic: s.topic || null, run: s.run || null, step: s.step || null, since: s.since || null, note: s.note || null };
  if (s.stage === 'fetching') out.book = s.book || null;
  return out;
}

const idle = (since) => ({ stage: 'idle', topic: null, run: null, step: null, since: since || null, note: null });

/** The stage as the dashboard shows it. */
function current(file, roots, now) {
  const at = now || Date.now();
  let own = readOwn(file);
  if (own && own.stage === 'fetching') {
    if (at < t(own.until)) return view(own);
    own = own.prior && STAGES.includes(own.prior.stage) && own.prior.stage !== 'fetching' ? own.prior : null;
  }

  const ms = marathonState(roots);
  const capMs = ((ms && Number(ms.hoursCap) > 0 ? Number(ms.hoursCap) : DEFAULT_HOURS_CAP) + 1) * 60 * 60 * 1000;
  const waves = ms && Array.isArray(ms.waves) ? ms.waves : [];
  const wave = [...waves].reverse().find((w) => w && w.status === 'in-progress' && at - t(w.startedAt) < capMs) || null;
  const running = Boolean(ms && ms.status === 'running' && !ms.paused && at - t(ms.startedAt) < capMs);
  const queue = ms && Array.isArray(ms.queue) ? ms.queue : [];
  const fromMarathon = () => {
    const n = wave && Number.isInteger(wave.waveNumber) ? wave.waveNumber : (Number.isInteger(ms.rotationIndex) ? ms.rotationIndex + 1 : null);
    const next = queue[Number.isInteger(ms.rotationIndex) ? ms.rotationIndex : -1];
    return {
      stage: 'researching', topic: (wave && wave.title) || (next && next.title) || null, run: ms.sessionId || null,
      step: n && queue.length && n <= queue.length ? { n, of: queue.length } : null,
      since: (wave && wave.startedAt) || ms.startedAt || null, note: n && queue.length ? `Wave ${n} of ${queue.length}` : null,
    };
  };

  if (wave && (!own || t(wave.startedAt) > t(own.updated))) return fromMarathon();
  if (own && (own.stage === 'idle' || at - t(own.updated) < STALE_MS)) return view(own);
  if (running) return fromMarathon();
  return idle(own ? iso(t(own.updated) + STALE_MS) : null);
}

module.exports = { STAGES, STALE_MS, FETCH_MS, stageFile, readOwn, set, startFetch, current, marathonState, parseStep };

if (require.main === module) {
  const config = require('./config');
  const out = (s) => process.stdout.write(`${s}\n`);
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(1); }
  const file = stageFile(cfg.home);

  if (cmd === 'get') { out(JSON.stringify(current(file, cfg.roots), null, 2)); process.exit(0); }
  if (cmd === 'set') {
    const stage = argv[1];
    const opts = {};
    for (let i = 2; i < argv.length; i += 1) {
      const m = /^--(topic|run|step|note)(?:=(.*))?$/.exec(argv[i]);
      if (!m) { out(`I do not know "${argv[i]}". Use --topic, --run, --step or --note.`); process.exit(2); }
      opts[m[1]] = m[2] != null ? m[2] : argv[i += 1];
    }
    try {
      const s = set(file, stage, opts);
      out(`Louise is now ${s.stage}${s.topic ? `: ${s.topic}` : ''}${s.step ? ` (step ${s.step.n} of ${s.step.of})` : ''}${s.note ? `. ${s.note}` : ''}`);
      process.exit(0);
    } catch (e) { out(e.message); process.exit(2); }
  }
  out('Use: node engine/stage.js set <idle|researching|council|distill|shelving|fetching> [--topic ".."] [--run ..] [--step n/of] [--note ".."]');
  out('     node engine/stage.js get');
  process.exit(2);
}
