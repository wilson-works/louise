'use strict';

/**
 * engine/skills.js — makes the skills Louise's runbook needs into project skills of her own folder, so a research run
 * started from her dashboard can leave the person's own Claude Code settings out (--setting-sources project,local, which
 * also leaves out the skills in ~/.claude/skills) and still have them. Node built-ins only.
 *
 * For each skill named in agent.json requires.skills, from the first place it is a real folder:
 *   1. <Hub>/.claude/skills/<name>   (the Hub: the first folder holding .hub/hub.json, walking up from her folder)
 *   2. ~/.claude/skills/<name>
 * it is copied (never linked) to <her folder>/.claude/skills/<name>/, which is git-ignored, and which a run may not
 * write (Edit(.claude/**) is denied). The copy is refreshed when the source has a file newer than the last copy, or
 * when it came from another place. A copy is made in a temporary folder beside it and then put in place.
 *
 * Limits: a skill name is lower-case letters, digits and dashes; a link (file or folder) anywhere in a source is
 * skipped, never followed, and a source folder that is itself a link is not used; at most 8 levels, 500 files and
 * 8 MB a skill. A source over those limits is not used.
 *
 *   ensure({ home, hub, homeDir, names, now })   { copied: [names], fresh: [names], missing: [names] }
 *   required(home)                               the skill names in her agent.json
 *   sourceOf(name, { hub, homeDir })             the folder it would be copied from, or null
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DEPTH = 8;
const MAX_FILES = 500;
const MAX_BYTES = 8 * 1024 * 1024;
const STAMP = '.louise-copy.json';

const realDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch (_) { return false; } };

function required(home) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(home, 'agent.json'), 'utf8').replace(/^﻿/, ''));
    const list = m && m.requires && Array.isArray(m.requires.skills) ? m.requires.skills : [];
    return list.filter((n) => typeof n === 'string' && NAME_RE.test(n));
  } catch (_) { return []; }
}

function sourceOf(name, opts) {
  const o = opts || {};
  if (!NAME_RE.test(String(name))) return null;
  const places = [];
  if (o.hub) places.push(path.join(o.hub, '.claude', 'skills', name));
  places.push(path.join(o.homeDir || os.homedir(), '.claude', 'skills', name));
  return places.find(realDir) || null;
}

/** Every plain file under dir (links skipped), as [{ rel, size, mtimeMs }], or null when over the limits. */
function listing(dir) {
  const out = [];
  let bytes = 0;
  const walk = (d, rel, depth) => {
    if (depth > MAX_DEPTH) return false;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!walk(path.join(d, e.name), r, depth + 1)) return false; continue; }
      if (!e.isFile() || e.name === STAMP) continue;
      const st = fs.lstatSync(path.join(d, e.name));
      bytes += st.size;
      out.push({ rel: r, size: st.size, mtimeMs: st.mtimeMs });
      if (out.length > MAX_FILES || bytes > MAX_BYTES) return false;
    }
    return true;
  };
  return walk(dir, '', 0) ? out : null;
}

function readStamp(dest) {
  try { return JSON.parse(fs.readFileSync(path.join(dest, STAMP), 'utf8')); } catch (_) { return null; }
}

function ensure(opts) {
  const o = opts || {};
  const home = path.resolve(o.home);
  const base = path.join(home, '.claude', 'skills');
  const result = { copied: [], fresh: [], missing: [] };
  for (const name of o.names || required(home)) {
    const src = sourceOf(name, o);
    const files = src ? listing(src) : null;
    if (!files || !files.some((f) => f.rel === 'SKILL.md')) { result.missing.push(name); continue; }
    const dest = path.join(base, name);
    const newest = Math.max(0, ...files.map((f) => f.mtimeMs));
    const stamp = readStamp(dest);
    if (stamp && stamp.from === src && stamp.newest >= newest && realDir(dest) && fs.existsSync(path.join(dest, 'SKILL.md'))) {
      result.fresh.push(name);
      continue;
    }
    fs.mkdirSync(base, { recursive: true });
    const tmp = path.join(base, `.${name}.${process.pid}.tmp`);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of files) {
      const to = path.join(tmp, ...f.rel.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(src, ...f.rel.split('/')), to);
    }
    fs.writeFileSync(path.join(tmp, STAMP), `${JSON.stringify({ from: src, newest, copied: new Date(o.now || Date.now()).toISOString() })}\n`);
    // The old copy goes: a link there is removed as a link, never followed.
    let old = null;
    try { old = fs.lstatSync(dest); } catch (_) { old = null; }
    if (old && old.isSymbolicLink()) { try { fs.unlinkSync(dest); } catch (_) { fs.rmdirSync(dest); } }
    else if (old) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    result.copied.push(name);
  }
  return result;
}

module.exports = { ensure, required, sourceOf, NAME_RE, MAX_FILES, MAX_BYTES, STAMP };
