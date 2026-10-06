'use strict';

/**
 * engine/check-citations.js — the citation check from marathon-research (its Phase 2, Step 7), shipped as Louise's own
 * script so a run started from her dashboard never writes and executes one. Node built-ins only. It only reads.
 *
 *   node engine/check-citations.js <topic folder> [--json]
 *
 * The topic folder must be inside one of her library roots. Every NN-*.md file in it except 00-brief.md is read; a
 * line that looks like a fact (the skill's own test: a digit, two capitalised words, or a verb such as is/was/has)
 * must have a URL, or a [^N] footnote that sources.md defines, on it or within the next three lines. Headings, quotes,
 * table rules, code blocks, lines ending in ":" and lines starting "Source:", "See", "Retrieved" and the like are skipped.
 *
 * Prints "CLAIMS:<n> FLAGGED:<m>", then each flagged line as "<file>:<line>: <text>" (--json: { totalClaims,
 * flaggedClaims, flaggedDetails: [{ file, lineNumber, line }] }). Exit codes: 0 checked; 2 the folder is not a topic
 * folder inside her library.
 *
 *   check(dir)   { totalClaims, flaggedClaims, flaggedDetails }
 */

const fs = require('fs');
const path = require('path');

const META_PREFIXES = /^(Retrieved|Retrieval|See|Source:|Sources:|Note:|Notes:|Per|For more|Read more|Full bibliography|Citation|Citations)\b/i;
const FACTUAL = /\d|[A-Z][a-z]+ [A-Z][a-z]+|\b(is|are|was|were|has|have|costs?|reaches?|reports?|states?|claims?|grew|reached|sworn|elected|born|served|holds|conducted)\b/;
const READ_MAX = 2 * 1024 * 1024;

function readSmall(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.size > READ_MAX) return '';
  return fs.readFileSync(file, 'utf8');
}

function check(dir) {
  const sourcesPath = path.join(dir, 'sources.md');
  const sourcesText = fs.existsSync(sourcesPath) ? readSmall(sourcesPath) : '';
  const sourceFootnotes = new Set([...sourcesText.matchAll(/^\[\^(\d+)\]:/gm)].map((m) => m[1]));
  const targetFiles = fs.readdirSync(dir).filter((f) => /^\d{2}-.*\.md$/.test(f) && f !== '00-brief.md').sort();
  let totalClaims = 0;
  const flaggedDetails = [];
  for (const f of targetFiles) {
    const lines = readSmall(path.join(dir, f)).replace(/```[\s\S]*?```/g, '').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('|---') || line === '---') continue;
      if (META_PREFIXES.test(line) || line.endsWith(':')) continue;
      if (!FACTUAL.test(line)) continue;
      totalClaims += 1;
      const lookahead = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
      const hasUrl = /https?:\/\/\S+/.test(lookahead);
      const fn = lookahead.match(/\[\^(\d+)\]/);
      if (!hasUrl && !(fn && sourceFootnotes.has(fn[1]))) flaggedDetails.push({ file: f, lineNumber: i + 1, line: line.slice(0, 200) });
    }
  }
  return { totalClaims, flaggedClaims: flaggedDetails.length, flaggedDetails };
}

module.exports = { check };

if (require.main === module) {
  const config = require('./config');
  const library = require('./library');
  const out = (s) => process.stdout.write(`${s}\n`);
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const target = args.filter((a) => a !== '--json');
  if (target.length !== 1) { out('Use: node engine/check-citations.js <topic folder> [--json]'); process.exit(2); }
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(2); }
  const dir = path.resolve(cfg.home, target[0]);
  const roots = [...cfg.roots.map((r) => r.path), cfg.writeRoot].filter(Boolean);
  let isDir = false;
  try { isDir = fs.lstatSync(dir).isDirectory(); } catch (_) { isDir = false; }
  if (!isDir || !roots.some((r) => library.inside(r, dir))) { out(`${target[0]} is not a topic folder inside Louise's library.`); process.exit(2); }
  const res = check(dir);
  if (json) { out(JSON.stringify(res, null, 2)); process.exit(0); }
  out(`CLAIMS:${res.totalClaims} FLAGGED:${res.flaggedClaims}`);
  for (const d of res.flaggedDetails) out(`${d.file}:${d.lineNumber}: ${d.line}`);
  process.exit(0);
}
