'use strict';

/**
 * engine/fetch.js — "Louise, fetch me ...": find the best book for a question and send her to the shelf for it.
 * Node built-ins only.
 *
 *   fetchBook(q, { roots, stateFile, now })   { book: "<id>" or null, matches: [ids] }. The stage goes to fetching
 *                                             for about six seconds (engine/stage.js), carrying the book she brings.
 *
 * CLI (from her folder):  node engine/fetch.js "<question>"
 *   Prints the book she brought back (its summary card first, then its pages, as file paths) and, when her dashboard
 *   is open, shows her fetching it.
 */

const library = require('./library');
const stage = require('./stage');

const Q_MAX = 200;

function fetchBook(q, opts) {
  const o = opts || {};
  const question = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
  if (!question) throw Object.assign(new Error('Tell Louise what to fetch.'), { status: 400 });
  if (question.length > Q_MAX) throw Object.assign(new Error(`That is a long one. Ask in ${Q_MAX} characters or fewer.`), { status: 400 });
  const index = library.get(o.roots);
  const hits = library.find(index, question).slice(0, 10);
  const top = hits[0] ? hits[0].book : null;
  stage.startFetch(o.stateFile, {
    q: question, book: top ? top.id : null, title: top ? top.title : question,
    note: top ? null : `Nothing on the shelves for "${question}" yet.`,
  }, o.now);
  return { book: top ? top.id : null, matches: hits.map((h) => h.book.id) };
}

module.exports = { fetchBook };

if (require.main === module) {
  const config = require('./config');
  const out = (s) => process.stdout.write(`${s}\n`);
  const q = process.argv.slice(2).join(' ');
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(1); }
  let res;
  try { res = fetchBook(q, { roots: cfg.roots, stateFile: stage.stageFile(cfg.home) }); } catch (e) { out(e.message); process.exit(2); }
  if (!res.book) { out(`Nothing on the shelves for "${q}". Louise can research it: node engine/requests.js add "${q}"`); process.exit(1); }
  const index = library.get(cfg.roots);
  const b = index.byId.get(res.book);
  out(`${b.title}  [${b.kind}${b.date ? `, ${b.date}` : ''}]  id ${b.id}`);
  const card = b.pages.find((p) => p.kind === 'card');
  if (card) out(`  Summary card: ${card.file}`);
  for (const p of b.pages.filter((x) => x !== card)) out(`  ${p.name}: ${p.file}`);
  if (res.matches.length > 1) out(`Also on the shelves: ${res.matches.slice(1, 5).map((id) => index.byId.get(id).title).join('; ')}`);
}
