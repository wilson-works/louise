'use strict';

/**
 * engine/seen.js — which books the person has opened on her dashboard, so that a newly finished one can wait for them.
 * Node built-ins only. The file is machine-local and git-ignored (state/), and it is never sent anywhere.
 *
 * The file: state/seen.json in her folder:
 *   { "since": "<ISO time the list was started>", "seen": ["<root folder>|<book id without its root number>", ...] }
 * A book is kept by its root's folder and its id without the leading root number, so adding or reordering library
 * roots never makes old books look new.
 *
 * The rules:
 *   1. The first time the list is read and there is no file, every book on the shelves now counts as seen, and the
 *      file is written. A library she already had never waits; only books that arrive after that do. The file is
 *      written only when every root but the examples is a readable folder at that moment; otherwise nothing waits on
 *      that visit and the next one tries again (an unreadable drive must not start the list empty).
 *   2. A book waits (is unseen) when it is finished, is not one of the invented examples, and is not in the list.
 *      The examples never wait and are never written to the list.
 *   3. A book is added to the list when the person closes it the first time (POST /api/seen).
 *   At most KEEP (20,000) books are kept; the oldest drop off first.
 *
 *   seenFile(home)                      state/seen.json
 *   keyOf(index, book)                  the book's lasting key
 *   unseen(file, index, now)            the waiting books, newest first: [{ id, title }] (writes the file on its first
 *                                       read)
 *   mark(file, index, id, now)          adds a book to the list; throws with .status 404 when it is not on the shelves.
 *                                       Returns { seen: n, unseen: [{ id, title }] }
 */

const fs = require('fs');
const path = require('path');

const KEEP = 20000;
const FILE_MAX = 4 * 1024 * 1024;

const seenFile = (home) => path.join(home, 'state', 'seen.json');

function keyOf(index, book) {
  const ri = Number(String(book.id).split('-')[0]);
  const root = index.roots && index.roots[ri];
  const where = root && root.path ? path.resolve(root.path).toLowerCase() : `root ${ri}`;
  return `${where}|${String(book.id).replace(/^\d+-/, '')}`;
}

function read(file) {
  try {
    if (fs.statSync(file).size > FILE_MAX) return null;
    const s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return s && Array.isArray(s.seen) ? { since: s.since || null, seen: s.seen.filter((k) => typeof k === 'string') } : null;
  } catch (_) { return null; }
}

/** Write a file so a reader never sees half of it: a temporary file, then a rename. */
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify({ since: data.since, seen: data.seen.slice(-KEEP) }, null, 1)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) {
    fs.writeFileSync(file, text, 'utf8');
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* the temporary file only */ }
  }
}

/** True when every root but the examples is a folder that can be read right now. */
function readable(index) {
  return (index.roots || []).every((r) => {
    if (r.example) return true;
    try { return fs.statSync(r.path).isDirectory() && Boolean(fs.readdirSync(r.path)); } catch (_) { return false; }
  });
}

/** The list, started from every book on the shelves now when there is no list yet (rule 1). The fresh list is kept
 *  only when every root could be read: a drive not there yet, or a folder refused, would otherwise keep an empty list
 *  and make every book wait on the next visit. Until then nothing waits, and the next visit tries again. */
function load(file, index, now) {
  const have = read(file);
  if (have) return have;
  const fresh = { since: new Date(now || Date.now()).toISOString(), seen: (index.books || []).filter((b) => !b.example).map((b) => keyOf(index, b)) };
  if (readable(index)) write(file, fresh);
  return fresh;
}

const newestFirst = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.title || '').localeCompare(String(b.title || ''));

function waiting(index, seen) {
  const set = new Set(seen);
  return (index.books || [])
    .filter((b) => !b.example && (b.status || 'finished') === 'finished' && !set.has(keyOf(index, b)))
    .sort(newestFirst).map((b) => ({ id: b.id, title: b.title }));
}

function unseen(file, index, now) {
  return waiting(index, load(file, index, now).seen);
}

function mark(file, index, id, now) {
  const book = typeof id === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(id) && index.byId ? index.byId.get(id) : null;
  if (!book) throw Object.assign(new Error('There is no such book on the shelves.'), { status: 404 });
  const list = load(file, index, now);
  const key = keyOf(index, book);
  if (!book.example && !list.seen.includes(key)) {
    list.seen.push(key);
    write(file, list);
  }
  return { seen: list.seen.length, unseen: waiting(index, list.seen) };
}

module.exports = { KEEP, seenFile, keyOf, unseen, mark };
