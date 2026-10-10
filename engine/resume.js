'use strict';

/**
 * engine/resume.js — the topics a research run did not finish, so "Pick up where I left off" on her dashboard
 * researches exactly those, and never one it finished. Node built-ins only.
 *
 * A run's list is the file engine/requests.js took for it: requests/taken/queue-<time taken>.md, the first one taken
 * after the run started (and before it stopped).
 *
 * A topic on that list is done when her library has a book for it from this run that is:
 *   - finished: its meta.json says "complete". marathon-research writes meta.json last, after the citation check, and
 *     this is the rule her shelves use (engine/library.js: "finished when meta.json says complete");
 *   - set aside for a missing source (flagged/), or waiting for a sharper question (failed/). Those are on her shelves
 *     already, and the same words would only be set aside again.
 * Every other topic is left: a draft with no meta.json, or one the run never reached. A resumed run researches those
 * again from the start, in the list's order, with the words and the request time they were asked with.
 *
 * Which book is a topic's (only the library folder new research goes to is read):
 *   - a folder the run's marathon-research state names for it: the wave with its title, or the wave for its queue
 *     entry's slug (the queue entry with its title, or the one in its place when the titles were changed);
 *   - or, dated no earlier than the day the run started: a folder whose name, without its date, is that slug or the
 *     slug marathon-research makes from the title, or a book whose title is the topic. A finished book counts this way
 *     only when its meta.json was written at or after the run started, so a book finished earlier the same day (the
 *     same topic, asked again) is not taken for this run's.
 * The state file counts as this run's only when it was written after the run started.
 *
 *   takenList(home, started, until)   the run's list file, or null when it took none
 *   leftovers({ home, started, list, roots, writeRoot })
 *                                     { list, n, of, left } or null when the list is not there or is empty.
 *                                     list: the list file's name; left: the positions on it (from 0) not done, in
 *                                     order; n: the topic the run stopped at (1 is the first); of: how many it had
 *   write(home, pick)                 writes those requests, line for line as they were taken, to requests/resume.md,
 *                                     which the next run takes before her list (engine/requests.js); returns the file
 *   slugify(title)                    marathon-research's slug for a title
 *   LIST_RE                           the name of a list file
 */

const fs = require('fs');
const path = require('path');
const requests = require('./requests');
const library = require('./library');
const { stateFileFor } = require('./run-state');

const LIST_RE = /^queue-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?\.md$/;
const DONE = new Set(['finished', 'flagged', 'failed']);
const LATE_MS = 60 * 1000; // a list taken just after the run's last heartbeat is still its own

const takenDir = (home) => path.join(home, 'requests', 'taken');
const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const undated = (slug) => String(slug || '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
const dayOf = (slug) => { const m = /^(\d{4}-\d{2}-\d{2})-/.exec(String(slug || '')); return m ? m[1] : ''; };
const pad = (n) => String(n).padStart(2, '0');

/** marathon-research's slug: lower case, every run of other characters one dash, no dash at either end, 60 at most. */
function slugify(title) {
  const s = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, 60).replace(/-$/, '');
}

/** When a list file was taken, from its name; NaN when the name is not a list file's. */
function takenAt(name) {
  const m = LIST_RE.exec(String(name));
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

/** The list the run took: the first list file taken after it started, and not long after it stopped. */
function takenList(home, started, until) {
  const from = Date.parse(started);
  if (!Number.isFinite(from)) return null;
  const to = Date.parse(until);
  let names = [];
  try { names = fs.readdirSync(takenDir(home)); } catch (_) { return null; }
  const hits = names.map((n) => ({ n, t: takenAt(n) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= from && (!Number.isFinite(to) || x.t <= to + LATE_MS))
    .sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
  return hits.length ? path.join(takenDir(home), hits[0].n) : null;
}

/** The earlier of the run's start day here and in UTC, so a folder dated either way counts. */
function firstDay(ms) {
  if (!Number.isFinite(ms)) return '9999-99-99';
  const d = new Date(ms);
  const here = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const utc = d.toISOString().slice(0, 10);
  return here < utc ? here : utc;
}

/** The run's marathon-research state, when the run wrote it (after it started), else null. */
function runStateOf(o, startedMs) {
  const file = stateFileFor({ writeRoot: o.writeRoot, roots: o.roots || [] });
  if (!file) return null;
  try {
    if (!(fs.statSync(file).mtimeMs >= startedMs)) return null;
    const s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch (_) { return null; }
}

/** The topic books in the library folder new research goes to, read now (no cache). */
function topicBooks(o) {
  const want = path.resolve(o.writeRoot);
  const root = (o.roots || []).find((r) => r && !r.example && path.resolve(r.path) === want)
    || { label: 'Library', path: want, council: 'council', state: path.join(want, 'marathon-research-state.json'), example: false };
  return library.buildIndex([root]).books.filter((b) => b.kind === 'topic');
}

/** A finished topic folder's meta.json (in the root, or under marathons/) was written at or after startedMs. */
function finishedSince(b, startedMs) {
  return [b.slug, path.join('marathons', b.slug)].some((rel) => {
    try { return fs.statSync(path.join(b.rootPath, rel, 'meta.json')).mtimeMs >= startedMs; } catch (_) { return false; }
  });
}

/** Is request i (of total) done in this run: a finished, flagged or failed book of its own? */
function isDone(req, i, total, state, books, since, startedMs) {
  const want = norm(req.topic);
  const queue = state && Array.isArray(state.queue) ? state.queue.filter((e) => e && typeof e === 'object') : [];
  const waves = state && Array.isArray(state.waves) ? state.waves.filter((w) => w && typeof w.slug === 'string') : [];
  const q = (want && queue.find((e) => norm(e.title) === want)) || (queue.length === total ? queue[i] : null);
  const qSlug = q && typeof q.slug === 'string' ? undated(q.slug) : '';
  const named = new Set(waves.filter((w) => (want && norm(w.title) === want) || (qSlug && undated(w.slug) === qSlug)).map((w) => w.slug));
  const slugs = new Set([qSlug, slugify(req.topic)].filter(Boolean));
  return books.some((b) => DONE.has(b.status) && (named.has(b.slug)
    || (dayOf(b.slug) >= since && (slugs.has(undated(b.slug)) || (Boolean(want) && norm(b.title) === want))
      && (b.status !== 'finished' || finishedSince(b, startedMs)))));
}

function leftovers(opts) {
  const o = opts || {};
  if (!o.home || !o.writeRoot || !o.list) return null;
  const file = path.isAbsolute(o.list) ? o.list : path.join(takenDir(o.home), o.list);
  if (!LIST_RE.test(path.basename(file)) || path.dirname(path.resolve(file)) !== path.resolve(takenDir(o.home))) return null;
  const reqs = requests.list(file);
  if (!reqs.length) return null;
  const startedMs = Date.parse(o.started);
  const state = runStateOf(o, startedMs);
  const books = topicBooks(o);
  const since = firstDay(startedMs);
  const done = reqs.map((r, i) => isDone(r, i, reqs.length, state, books, since, startedMs));
  const left = done.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
  return { list: path.basename(file), n: Math.min(done.lastIndexOf(true) + 2, reqs.length), of: reqs.length, left };
}

/** The pick-up list: the left requests, each exactly as it was written on the run's list. */
function write(home, pick) {
  const { blocks } = requests.split(fs.readFileSync(path.join(takenDir(home), pick.list), 'utf8').replace(/^﻿/, ''));
  const keep = pick.left.map((i) => blocks[i]).filter(Boolean);
  const text = `${requests.HEADER}${keep.map((b) => `\n${b.raw.join('').replace(/\s+$/, '')}\n`).join('')}`;
  const to = requests.resumeFile(home);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, text, 'utf8');
  return to;
}

module.exports = { takenList, leftovers, write, slugify, LIST_RE };
