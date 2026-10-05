'use strict';

/**
 * engine/requests.js — Louise's list: research people have asked for, kept in requests/queue.md in exactly the
 * queue format marathon-research reads (`/marathon-research --queue requests/queue.md`). Node built-ins only.
 *
 *   # Research Queue
 *
 *   ## When can I plant tomatoes outside?
 *   <!-- requested 2026-10-05T19:40:00.000Z -->
 *   I use raised beds where it's cold.
 *
 * Each "## " heading is one topic; the lines under it are its framing. The comment records when it was asked.
 * A line of framing that starts with "#" is written with a "\" in front, so framing can never start a new topic.
 *
 *   add(file, { topic, framing }, now)  appends one request: { queued: <how many are on the list now> }.
 *                                       Throws (status 400) on a topic it cannot use, or when the list is full.
 *   list(file)                          [{ topic, framing, at }], oldest first
 *   take(file, now)                     moves the list to requests/taken/queue-<time>.md for a run to work through,
 *                                       leaving an empty list; returns that file, or null when the list was empty
 *
 * CLI (from her folder):
 *   node engine/requests.js list
 *   node engine/requests.js add "<topic>" ["<framing>"]
 *   node engine/requests.js take        prints the file to pass to marathon-research as --queue
 */

const fs = require('fs');
const path = require('path');

const TOPIC_MAX = 200;
const FRAMING_MAX = 2000;
const LIST_MAX = 100;
const HEADER = '# Research Queue\n';

const queueFile = (home) => path.join(home, 'requests', 'queue.md');
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function read(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch (_) { return ''; }
}

/** The requests in a queue file, oldest first. */
function parse(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = { topic: h[1], body: [], at: null }; out.push(cur); continue; }
    if (!cur) continue;
    const at = /^<!--\s*requested\s+(\S+)\s*-->$/.exec(line.trim());
    if (at && !cur.at) { cur.at = at[1]; continue; }
    cur.body.push(line.replace(/^\\#/, '#'));
  }
  return out.map((r) => ({ topic: r.topic, framing: r.body.join('\n').trim(), at: r.at }));
}

function list(file) { return parse(read(file)); }

function add(file, req, now) {
  const r = req || {};
  if (typeof r.topic !== 'string') throw bad('Say what you would like Louise to look up.');
  const topic = r.topic.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim();
  if (topic.length < 3) throw bad('Say what you would like Louise to look up, in a few words at least.');
  if (topic.length > TOPIC_MAX) throw bad(`Keep the question to ${TOPIC_MAX} characters. Put the rest under "Anything I should know?".`);
  if (r.framing != null && typeof r.framing !== 'string') throw bad('The framing must be text.');
  const framing = String(r.framing || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim();
  if (framing.length > FRAMING_MAX) throw bad(`Keep the framing to ${FRAMING_MAX} characters.`);
  const have = list(file);
  if (have.length >= LIST_MAX) throw bad(`Louise's list is full (${LIST_MAX} questions). Set her to work on it first.`);

  const at = new Date(now || Date.now()).toISOString();
  const body = framing ? `${framing.split('\n').map((l) => l.replace(/^(\s*)#/, '$1\\#')).join('\n')}\n` : '';
  const existing = read(file);
  const start = existing.trim() ? (existing.endsWith('\n') ? existing : `${existing}\n`) : `${HEADER}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${start}\n## ${topic}\n<!-- requested ${at} -->\n${body}`, 'utf8');
  return { queued: have.length + 1 };
}

/** Move the list aside for a run to work through. The list file is left empty, never deleted. */
function take(file, now) {
  const have = list(file);
  if (!have.length) return null;
  const stamp = new Date(now || Date.now()).toISOString().replace(/[:.]/g, '-');
  const dir = path.join(path.dirname(file), 'taken');
  fs.mkdirSync(dir, { recursive: true });
  let to = path.join(dir, `queue-${stamp}.md`);
  for (let n = 2; fs.existsSync(to); n += 1) to = path.join(dir, `queue-${stamp}-${n}.md`);
  fs.copyFileSync(file, to);
  if (read(to) !== read(file)) throw new Error(`The copy of the list at ${to} does not match; the list was left as it is.`);
  fs.writeFileSync(file, HEADER, 'utf8');
  return to;
}

module.exports = { queueFile, add, list, take, parse, LIST_MAX };

if (require.main === module) {
  const config = require('./config');
  const out = (s) => process.stdout.write(`${s}\n`);
  const [cmd, a, b] = process.argv.slice(2);
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(1); }
  const file = queueFile(cfg.home);
  if (cmd === 'list' || !cmd) {
    const rs = list(file);
    if (!rs.length) { out("Louise's list is empty."); process.exit(0); }
    rs.forEach((r, i) => out(`${i + 1}. ${r.topic}${r.at ? `  (asked ${r.at})` : ''}${r.framing ? `\n   ${r.framing.replace(/\n/g, '\n   ')}` : ''}`));
    process.exit(0);
  }
  if (cmd === 'add') {
    try { out(`On Louise's list as number ${add(file, { topic: a, framing: b }).queued}.`); process.exit(0); } catch (e) { out(e.message); process.exit(2); }
  }
  if (cmd === 'take') {
    const to = take(file);
    if (!to) { out("Louise's list is empty: nothing to research."); process.exit(1); }
    out(to);
    process.exit(0);
  }
  out('Use: node engine/requests.js list | add "<topic>" ["<framing>"] | take');
  process.exit(2);
}
