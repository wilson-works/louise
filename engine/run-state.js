'use strict';

/**
 * engine/run-state.js — writes the marathon-research state file for a run started from Louise's dashboard, so the run
 * never has to write and execute a script of its own (the skill's "temp JS file pattern"). Node built-ins only.
 *
 * The file is always the one in her library: marathon-research-state.json in the folder new research goes to (or that
 * root's own "state" in louise.config.json). No other path can be named.
 *
 * CLI (from her folder):
 *   node engine/run-state.js get                     prints the state (or {} when there is none yet)
 *   node engine/run-state.js set '<json object>'     merges the object's keys into the state, top level only (a key
 *                                                    given replaces that key), creating the file when it is not there
 *   node engine/run-state.js wave '<json object>'    puts one entry into "waves": it replaces the entry with the same
 *                                                    "slug" (else the same "waveNumber"), otherwise it is added at the end
 * Each write prints the state as written. Exit codes: 0 done; 2 the arguments or the JSON could not be used; 1 there is
 * no library folder.
 *
 *   stateFileFor(cfg)        the state file's path
 *   apply(file, cmd, json)   the same as the CLI, for tests: returns the state
 */

const fs = require('fs');
const path = require('path');

const MAX = 4 * 1024 * 1024;

function stateFileFor(cfg) {
  if (!cfg || !cfg.writeRoot) return null;
  const first = (cfg.roots || []).find((r) => r && !r.example && path.resolve(r.path) === path.resolve(cfg.writeRoot));
  return first && first.state ? first.state : path.join(cfg.writeRoot, 'marathon-research-state.json');
}

function read(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return {}; }
  const s = JSON.parse(text.replace(/^﻿/, ''));
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('The state file does not hold one JSON object, so it was left as it is.');
  return s;
}

function object(json) {
  let v;
  try { v = JSON.parse(String(json)); } catch (e) { throw Object.assign(new Error(`That is not readable JSON: ${e.message}`), { code: 2 }); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('Give one JSON object.'), { code: 2 });
  return v;
}

function apply(file, cmd, json) {
  if (cmd === 'get') return read(file);
  if (cmd !== 'set' && cmd !== 'wave') throw Object.assign(new Error('Use: get | set \'<json object>\' | wave \'<json object>\''), { code: 2 });
  const v = object(json);
  const state = read(file);
  if (cmd === 'set') Object.assign(state, v);
  else {
    const waves = Array.isArray(state.waves) ? state.waves : [];
    const at = waves.findIndex((w) => w && ((v.slug != null && w.slug === v.slug) || (v.slug == null && v.waveNumber != null && w.waveNumber === v.waveNumber)));
    if (at >= 0) waves[at] = Object.assign({}, waves[at], v); else waves.push(v);
    state.waves = waves;
  }
  const text = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX) throw Object.assign(new Error('The state would be over 4 MB, so it was left as it is.'), { code: 2 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, text, 'utf8'); fs.rmSync(tmp, { force: true }); }
  return state;
}

module.exports = { stateFileFor, apply };

if (require.main === module) {
  const config = require('./config');
  const out = (s) => process.stdout.write(`${s}\n`);
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(1); }
  const file = stateFileFor(cfg);
  if (!file) { out('Louise has no library folder yet, so there is no state file to write.'); process.exit(1); }
  const [cmd, json, extra] = process.argv.slice(2);
  if (extra !== undefined) { out('Give the JSON as one argument, in single quotes.'); process.exit(2); }
  try { out(JSON.stringify(apply(file, cmd || 'get', json), null, 2)); process.exit(0); } catch (e) { out(e.message); process.exit(e.code || 2); }
}
