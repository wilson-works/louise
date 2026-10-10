'use strict';

/**
 * engine/config.js — where Louise's library is, where new research goes, and her port. Node built-ins only.
 *
 * The library roots, first match wins:
 *   1. louise.config.json in her folder:
 *        { "port": 7540, "library": { "roots": [ { "label": "My research", "path": "<Hub>/50-AI/research" } ] } }
 *      A path may start with <Hub> (this computer's Hub) or ~ (your home folder); a relative path is read from her
 *      folder. A root may also name "council" (its council folder, default "council") and "state" (the
 *      marathon-research state file, default <root>/marathon-research-state.json).
 *   2. <Hub>/50-AI/research, where <Hub> is the first folder holding .hub/hub.json, walking up from her folder.
 *   3. examples/library in her folder, so a fresh install has something on the shelves.
 * When the Hub is found but its research folder is not there yet, the shelves show the examples and new research
 * still goes to <Hub>/50-AI/research (the first run makes it). New research never goes into the examples.
 *
 * Her phone address: "phone" in louise.config.json (for example "https://desk.example-tailnet.ts.net:8444/"), else
 * door.phone in her agent.json. Her dashboard answers that host name as well as 127.0.0.1 and localhost.
 *
 * Her port: "port" in louise.config.json, else probe.port in her agent.json (install-agent rewrites it when 7540 is
 * taken), else 7540.
 *
 * Claude Code, for a research run started from her dashboard (engine/research.js): "claude" in louise.config.json, the
 * path to the program (~ and relative paths as for a root). Without it, research.js looks on the PATH, in
 * ~/.local/bin, in npm's folder (Windows) and in the VS Code extension (findClaude).
 *
 *   load(opts)  { home, port, roots: [{ label, path, council, state, example }], writeRoot, source, hub,
 *                 phoneHost, claude, file, notes }   opts { home } (default: her folder). Throws, in plain words, when
 *                 louise.config.json is there but cannot be used: a broken config is fixed, never skipped past.
 *   CLI         node engine/config.js         the roots, where new research goes, and the port
 *               node engine/config.js where   only the folder new research goes to (nothing when there is none)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.resolve(__dirname, '..');
const DEFAULT_PORT = 7540;
const CONFIG_FILE = 'louise.config.json';
const HUB_MARKER = path.join('.hub', 'hub.json');

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const portOk = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

/** The first folder at or above `from` that holds .hub/hub.json, or null. */
function findHub(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (isFile(path.join(dir, HUB_MARKER))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** A root's path from the config: <Hub>/..., ~/..., absolute, or relative to her folder. Null when <Hub> is unknown. */
function expand(p, home, hub) {
  const s = String(p).trim();
  if (/^<hub>([\\/]|$)/i.test(s)) return hub ? path.join(hub, s.slice(5)) : null;
  if (/^~([\\/]|$)/.test(s)) return path.join(os.homedir(), s.slice(1));
  return path.resolve(home, s);
}

/** One root as the engine uses it. */
function root(label, dir, extra, example) {
  const e = extra || {};
  const council = typeof e.council === 'string' && e.council.trim() ? e.council.trim() : 'council';
  return {
    label: String(label || path.basename(dir)),
    path: dir,
    council,
    state: e.state ? path.resolve(dir, String(e.state)) : path.join(dir, 'marathon-research-state.json'),
    example: Boolean(example),
  };
}

/** The host name in her agent.json door.phone, or null. */
function phoneHostOf(manifest) {
  try { return manifest && manifest.door && manifest.door.phone ? new URL(manifest.door.phone).hostname.toLowerCase() : null; } catch (_) { return null; }
}

function load(opts) {
  const o = opts || {};
  const home = path.resolve(o.home || HOME);
  const file = path.join(home, CONFIG_FILE);
  const hub = findHub(home);
  const notes = [];

  let manifest = null;
  try { manifest = readJson(path.join(home, 'agent.json')); } catch (_) { /* no agent.json: the defaults below */ }

  let cfg = null;
  if (isFile(file)) {
    try { cfg = readJson(file); } catch (e) {
      throw new Error(`${CONFIG_FILE} cannot be read (${e.message}). Fix it, or move it out of her folder to use the defaults.`);
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${CONFIG_FILE} must hold one JSON object.`);
  }

  let port = DEFAULT_PORT;
  if (cfg && cfg.port != null) {
    if (!portOk(cfg.port)) throw new Error(`"port" in ${CONFIG_FILE} must be a whole number from 1024 to 65535.`);
    port = cfg.port;
  } else if (manifest && manifest.probe && portOk(manifest.probe.port)) {
    port = manifest.probe.port;
  }

  const examples = root('Examples', path.join(home, 'examples', 'library'), null, true);
  let roots = [];
  let writeRoot = null;
  let source;

  const listed = cfg && cfg.library && cfg.library.roots;
  if (listed != null) {
    if (!Array.isArray(listed) || listed.length === 0) throw new Error(`"library.roots" in ${CONFIG_FILE} must be a list with at least one folder.`);
    listed.forEach((r, i) => {
      const entry = typeof r === 'string' ? { path: r } : r;
      if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) {
        throw new Error(`Library root ${i + 1} in ${CONFIG_FILE} needs a "path".`);
      }
      const dir = expand(entry.path, home, hub);
      if (!dir) { notes.push(`Root ${i + 1} (${entry.path}) uses <Hub>, but no Hub was found above ${home}. It is left out.`); return; }
      if (!isDir(dir)) notes.push(`Root ${i + 1} (${dir}) is not there yet. Its shelves are empty until research is written to it.`);
      roots.push(root(entry.label || `Library ${i + 1}`, dir, entry, false));
    });
    if (!roots.length) throw new Error(`None of the library roots in ${CONFIG_FILE} can be used: ${notes.join(' ')}`);
    writeRoot = roots[0].path;
    source = 'config';
  } else if (hub) {
    const dir = path.join(hub, '50-AI', 'research');
    writeRoot = dir;
    if (isDir(dir)) {
      roots = [root('My research', dir, null, false)];
      source = 'hub';
    } else {
      roots = [examples];
      source = 'examples';
      notes.push(`${dir} is not there yet, so the shelves show the examples. Her first run writes there.`);
    }
  } else {
    roots = [examples];
    source = 'examples';
    notes.push(`No ${CONFIG_FILE} and no Hub above ${home}, so the shelves show the examples. ` +
      `To give her a library, copy louise.config.example.json to ${CONFIG_FILE} and name a folder.`);
  }

  // Her phone address: "phone" in louise.config.json (this computer's own tailnet address, kept out of agent.json so
  // it is never committed), else door.phone in agent.json.
  let phoneHost = phoneHostOf(manifest);
  if (cfg && cfg.phone != null) {
    phoneHost = phoneHostOf({ door: { phone: String(cfg.phone).includes('://') ? cfg.phone : `https://${cfg.phone}` } });
    if (!phoneHost) throw new Error(`"phone" in ${CONFIG_FILE} must be an address, for example https://desk.example-tailnet.ts.net:8444/.`);
  }

  // Claude Code for a run started from her dashboard: "claude" in louise.config.json, else found on the PATH later.
  let claude = null;
  if (cfg && cfg.claude != null) {
    if (typeof cfg.claude !== 'string' || !cfg.claude.trim()) throw new Error(`"claude" in ${CONFIG_FILE} must be the path to Claude Code, for example "~/.local/bin/claude".`);
    claude = expand(cfg.claude, home, hub);
  }

  return { home, port, roots, writeRoot, source, hub, phoneHost, claude, file, notes };
}

module.exports = { load, findHub, expand, DEFAULT_PORT, CONFIG_FILE, HOME };

if (require.main === module) {
  let c;
  try { c = load(); } catch (e) { process.stdout.write(`${e.message}\n`); process.exit(1); }
  if (process.argv[2] === 'where') {
    if (c.writeRoot) process.stdout.write(`${c.writeRoot}\n`);
    process.exit(c.writeRoot ? 0 : 1);
  }
  const out = (s) => process.stdout.write(`${s}\n`);
  out(`Louise's library (${c.source === 'config' ? `from ${CONFIG_FILE}` : c.source === 'hub' ? 'the Hub research folder' : 'the examples'}):`);
  for (const r of c.roots) out(`  ${r.label}: ${r.path}${r.example ? ' (examples)' : ''}`);
  out(`New research goes to: ${c.writeRoot || 'nowhere yet (see below)'}`);
  out(`Her dashboard port: ${c.port}`);
  for (const n of c.notes) out(`Note: ${n}`);
}
