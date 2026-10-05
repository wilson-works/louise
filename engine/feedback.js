'use strict';

/**
 * engine/feedback.js — what Louise remembers about the books she fetched: for a question, was the book she opened the
 * one you needed? Node built-ins only. The file is machine-local and git-ignored, and it is never sent anywhere.
 *
 * The file: state/feedback.jsonl in her folder, one answer a line, oldest first, at most KEEP (2,000) answers (older
 * ones drop off as new ones come):
 *   {"at":"<ISO time>","words":["plant","tomato","outside"],"book":"0-t-2026-09-14-frost-dates-for-raised-beds","helpful":true}
 * "words" are the question's meaningful words, normalised: lower case, letters and digits only, the library's common
 * words and question words left out, a plural "s" dropped, each word once, sorted. The question itself is not kept.
 *
 * How an answer changes what she brings for a new question (tally, used by library.find):
 *   1. An earlier answer counts for the new question when they share at least half of the new question's meaningful
 *      words (and at least one). "When can I plant tomatoes outside?" and "Is it safe to plant tomatoes outdoors?"
 *      share "plant" and "tomato": 2 of 3, so it counts.
 *   2. For each book, every counting Yes adds 1 and every counting No takes 1 away: its net.
 *   3. Books with a net above 0 come first (higher net first), then the books nobody has answered about, then books
 *      with a net below 0. Within each group the word match decides, as before. A book confirmed for a similar question
 *      comes back even when its own words do not match the new question.
 *   A book id that is no longer on the shelves is ignored.
 *
 *   feedbackFile(home)                  state/feedback.jsonl
 *   words(q)                            the normalised words
 *   read(file)                          the answers, oldest first (unreadable lines skipped)
 *   record(file, { q, book, helpful }, { known(id) }, now)
 *                                       appends one answer; throws with .status 400 (q, helpful) or 404 (book)
 *   tally(answers, q)                   Map(book id -> { yes, no, net })
 */

const fs = require('fs');
const path = require('path');

const KEEP = 2000;
const Q_MAX = 300;
// The library's common words (engine/library.js) and the words a question starts with: none of them says what it is about.
const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'on', 'for', 'to', 'in', 'what', 'do', 'we', 'have', 'about', 'is',
  'are', 'any', 'our', 'my', 'me', 'with', 'how', 'can', 'you', 'find', 'get', 'fetch', 'louise', 'please', 'book', 'research',
  'when', 'where', 'which', 'who', 'why', 'should', 'would', 'could', 'does', 'did', 'it', 'its', 'be', 'there', 'that',
  'this', 'will', 'or', 'at', 'by', 'from', 'if']);

const feedbackFile = (home) => path.join(home, 'state', 'feedback.jsonl');
const bad = (status, message) => Object.assign(new Error(message), { status });

function words(q) {
  const out = new Set();
  for (const w of String(q || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1).replace(/oe$/, 'o') : w);
  }
  return [...out].sort();
}

function read(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line);
      if (a && Array.isArray(a.words) && typeof a.book === 'string' && typeof a.helpful === 'boolean') out.push(a);
    } catch (_) { /* a damaged line is skipped, never fatal */ }
  }
  return out;
}

function record(file, answer, opts, now) {
  const a = answer || {};
  const o = opts || {};
  if (typeof a.q !== 'string' || !a.q.trim()) throw bad(400, 'Say which question this answer is for.');
  const q = a.q.replace(/\s+/g, ' ').trim().slice(0, Q_MAX);
  const w = words(q);
  if (!w.length) throw bad(400, 'That question has no words I can remember it by.');
  if (typeof a.helpful !== 'boolean') throw bad(400, 'Say yes or no: was this the book you needed?');
  if (typeof a.book !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(a.book) || !(o.known && o.known(a.book))) {
    throw bad(404, 'There is no such book on the shelves.');
  }
  const entry = { at: new Date(now || Date.now()).toISOString(), words: w, book: a.book, helpful: a.helpful };
  const kept = read(file).slice(-(KEEP - 1));
  kept.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = `${kept.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, text, 'utf8'); fs.rmSync(tmp, { force: true }); }
  return { remembered: kept.length };
}

function tally(answers, q) {
  const qw = words(q);
  const out = new Map();
  if (!qw.length) return out;
  const need = Math.max(1, Math.ceil(qw.length / 2));
  for (const a of answers || []) {
    const shared = qw.filter((w) => a.words.includes(w)).length;
    if (shared < need) continue;
    const t = out.get(a.book) || { yes: 0, no: 0, net: 0 };
    if (a.helpful) t.yes += 1; else t.no += 1;
    t.net = t.yes - t.no;
    out.set(a.book, t);
  }
  return out;
}

module.exports = { feedbackFile, words, read, record, tally, KEEP, Q_MAX };
