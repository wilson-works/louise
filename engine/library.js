'use strict';

/**
 * engine/library.js — Louise's library: every book on her shelves, read from the library roots. Node built-ins only.
 *
 * The layout, per root (SPEC.md, "The library on disk"). Nothing deeper is read, and links are never followed:
 *   <root>/<YYYY-MM-DD>-<slug>/          a research topic (marathon-research): 00-brief.md, NN-*.md, sources.md,
 *                                        meta.json, and _validation-report.md when it was flagged
 *   <root>/marathons/<YYYY-MM-DD>-<slug>/  the same, for a research folder laid out the way distill expects
 *   <root>/failed/  and  <root>/flagged/   topics that failed their scope check (a .md stub, or a folder) or their
 *                                        citation check (a folder); also under marathons/
 *   <root>/summaries/<card>.md           distill's summary cards (200 lines or fewer); _index.md links each card
 *                                        to its topic. A card with no topic on the shelves is a book of its own.
 *   <root>/<council>/council-summary-<timestamp>.md   a council's proceedings (its transcript is a second page)
 *   <root>/runs/<run>.md                 Louise's run summary books (front matter names the run and its topics)
 *   <root>/marathon-research-state.json  the run in progress (its waves name each topic's run)
 *
 * A book is { id, title, kind: topic|council|run-summary, status: finished|in-progress|failed|flagged, date, run,
 * sources, lines, pages }. Its id is <root number>-<t|f|x|s|c|r>-<folder or file name>: an id is only ever looked up
 * in the index, never turned into a path. A page is read only when its real path is inside its root, and only up
 * to 512 KB.
 *
 *   get(roots)                  the index, cached for a few seconds
 *   shelves(index, {arrange,q}) { sections: [{ id, label, count }], books: [...] } for GET /api/library
 *   bookView(index, id)         { id, title, kind, status, date, run, pages: [{ n, name, file }] } or null
 *   readPage(index, id, n)      { n, name, markdown }; throws an error with .status 404, 403 or 413
 *   find(index, q)              [{ book, score }], best first
 *
 * CLI (from her folder):
 *   node engine/library.js find "<question>"            the best matching books, with their summary cards and pages
 *   node engine/library.js list [--arrange topic|run|month|status] [--q <words>]
 *   Add --json to either for the raw answer.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE_CAP = 512 * 1024;
const SMALL_READ = 64 * 1024;
const TTL_MS = 5000;
const TOPIC_RE = /^(\d{4}-\d{2}-\d{2})-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const REPORT_RE = /^\d{2}-.*\.md$/i;
const ARRANGEMENTS = ['topic', 'run', 'month', 'status'];
const STATUS_ORDER = ['finished', 'in-progress', 'flagged', 'failed'];
let STATUS_LABEL = { finished: 'Finished', 'in-progress': 'Still researching', flagged: 'Missing sources', failed: 'Needs a sharper question' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LETTER_SHELVES = [['a-e', 'A to E', /^[a-e]/], ['f-j', 'F to J', /^[f-j]/], ['k-o', 'K to O', /^[k-o]/],
  ['p-t', 'P to T', /^[p-t]/], ['u-z', 'U to Z', /^[u-z]/], ['other', 'Numbers and others', /./]];
const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'on', 'for', 'to', 'in', 'what', 'do', 'we', 'have', 'about', 'is',
  'are', 'any', 'our', 'my', 'me', 'with', 'how', 'can', 'you', 'find', 'get', 'fetch', 'louise', 'please', 'book', 'research']);

/* ------------------------------------------------------------------ small readers */

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.isSymbolicLink()); } catch (_) { return []; }
}
const dirsIn = (dir) => entries(dir).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const filesIn = (dir) => entries(dir).filter((e) => e.isFile()).map((e) => e.name).sort();

/** The start of a text file (at most `max` bytes), or ''. */
function head(file, max) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(max || SMALL_READ);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.slice(0, n).toString('utf8').replace(/^\uFEFF/, '');
  } catch (_) { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function lineCount(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 4 * PAGE_CAP) return Math.round(st.size / 60);
    const t = fs.readFileSync(file, 'utf8');
    return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0;
  } catch (_) { return 0; }
}

function readJsonSmall(file) {
  try { return JSON.parse(head(file, SMALL_READ)); } catch (_) { return null; }
}

/** `key: value` lines between two `---` lines at the top of a file, with [a, b] lists. */
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    data[kv[1].toLowerCase()] = v;
  }
  return { data, body: text.slice(m[0].length) };
}

/** The first `# ` heading of a markdown text, or ''. */
function firstHeading(text) {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(text || '');
  return m ? m[1].trim() : '';
}

/** "2026-10-01-frost-dates-for-raised-beds" -> "Frost dates for raised beds". */
function words(slug) {
  const s = String(slug).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : String(slug);
}

/** Words from brand/copy.json (book.pageNames, library.status), so the shelves and the dashboard say the same thing. */
const COPY = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'brand', 'copy.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return {}; }
})();
function fromCopy(defaults, found) {
  const d = Object.assign({}, defaults);
  if (found && typeof found === 'object') for (const k of Object.keys(d)) if (typeof found[k] === 'string' && found[k].trim()) d[k] = found[k].trim();
  return d;
}
const PAGE_NAMES = fromCopy({ brief: 'The question', overview: 'Overview', 'deep-dive': 'In depth', sources: 'Sources', card: 'Summary card', council: 'Reading-room notes' },
  COPY.book && COPY.book.pageNames);
STATUS_LABEL = fromCopy(STATUS_LABEL, COPY.library && COPY.library.status);

/** A topic folder's file as a page: { kind, name }. "00-brief.md" is "The question"; "02-deep-dive.md" is "In depth". */
function pageOf(file) {
  const f = file.toLowerCase();
  if (f === '00-brief.md') return { kind: 'brief', name: PAGE_NAMES.brief };
  if (f === 'sources.md') return { kind: 'sources', name: PAGE_NAMES.sources };
  if (f === '_validation-report.md') return { kind: 'validation', name: 'The missing sources' };
  const bare = f.replace(/^\d{2}-/, '').replace(/\.md$/, '');
  if (PAGE_NAMES[bare] && bare !== 'brief' && bare !== 'card' && bare !== 'council') return { kind: 'report', name: PAGE_NAMES[bare] };
  return { kind: 'report', name: words(file.replace(/^\d{2}-/, '')) };
}

const dateOf = (s) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(s || '')); return m ? m[1] : null; };

function idFor(ri, code, name) {
  const n = String(name).replace(/\.md$/i, '');
  return `${ri}-${code}-${NAME_RE.test(n) ? n : `h${crypto.createHash('sha1').update(n).digest('hex').slice(0, 12)}`}`;
}

/* ------------------------------------------------------------------ one root */

/** The pages of a topic folder, in reading order. */
function topicPages(dir) {
  const files = filesIn(dir);
  const pages = [];
  const add = (f) => pages.push(Object.assign(pageOf(f), { file: path.join(dir, f) }));
  if (files.includes('00-brief.md')) add('00-brief.md');
  for (const f of files.filter((x) => REPORT_RE.test(x) && x.toLowerCase() !== '00-brief.md')) add(f);
  if (files.includes('sources.md')) add('sources.md');
  if (files.includes('_validation-report.md')) add('_validation-report.md');
  return pages;
}

function topicBook(r, ri, dir, slug, code, status) {
  const meta = readJsonSmall(path.join(dir, 'meta.json')) || {};
  const pages = topicPages(dir);
  const reports = pages.filter((p) => REPORT_RE.test(path.basename(p.file)) && path.basename(p.file) !== '00-brief.md');
  let st = status;
  if (!st) st = meta.status === 'complete' ? 'finished' : /^fail/.test(String(meta.status || '')) ? 'failed' : 'in-progress';
  const brief = pages[0] && pages[0].kind === 'brief' ? head(pages[0].file, 4096) : '';
  const briefTitle = firstHeading(brief).replace(/^(scope\s+)?brief\s*[:—–-]+\s*/i, '').trim();
  const title = (typeof meta.title === 'string' && meta.title.trim()) || briefTitle || words(slug);
  let sources = Number.isInteger(meta.sourceCount) ? meta.sourceCount : null;
  if (sources == null) {
    const s = head(path.join(dir, 'sources.md'), PAGE_CAP);
    sources = (s.match(/^\[\^\d+\]:/gm) || []).length;
  }
  const lines = Number.isInteger(meta.totalLines) ? meta.totalLines : reports.reduce((a, p) => a + lineCount(p.file), 0);
  return {
    id: idFor(ri, code, slug), slug, title, kind: 'topic', status: st, date: dateOf(slug) || dateOf(meta.completedAt),
    run: null, sources, lines, root: ri, rootPath: r.path, pages, text: `${title} ${slug} ${brief.slice(0, 1500)}`,
  };
}

function stubBook(r, ri, file, code, status) {
  const name = path.basename(file, '.md');
  const t = head(file, 4096);
  const title = (firstHeading(t).replace(/^(FAILED|FLAGGED)\s*[—:-]+\s*/i, '') || words(name)).trim();
  return {
    id: idFor(ri, code, name), slug: name, title, kind: 'topic', status, date: dateOf(name), run: null, sources: 0,
    lines: lineCount(file), root: ri, rootPath: r.path,
    pages: [status === 'failed' ? { kind: 'brief', name: PAGE_NAMES.brief, file } : { kind: 'note', name: 'The note', file }],
    text: `${title} ${name} ${t.slice(0, 1500)}`,
  };
}

/** _index.md: which summary card goes with which topic folder, by the topic sections that name both. */
function indexLinks(rootPath) {
  const links = new Map();
  const t = head(path.join(rootPath, '_index.md'), PAGE_CAP);
  if (!t) return links;
  for (const section of t.split(/^#{2,3}\s+/m)) {
    const slugs = [...section.matchAll(/(?:^|[\s`(/])(\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*?)(?=[\s`)/]|$)/gm)].map((m) => m[1]);
    const cards = [...section.matchAll(/summaries\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md/g)].map((m) => m[1]);
    for (const c of cards) for (const s of slugs) if (!links.has(c)) links.set(c, s);
  }
  return links;
}

function scanRoot(r, ri) {
  const books = [];
  const bases = [r.path];
  if (dirsIn(r.path).includes('marathons')) bases.push(path.join(r.path, 'marathons'));

  for (const base of bases) {
    for (const name of dirsIn(base)) if (TOPIC_RE.test(name)) books.push(topicBook(r, ri, path.join(base, name), name, 't', null));
    for (const [sub, code, status] of [['failed', 'f', 'failed'], ['flagged', 'x', 'flagged']]) {
      const d = path.join(base, sub);
      for (const name of dirsIn(d)) if (TOPIC_RE.test(name)) books.push(topicBook(r, ri, path.join(d, name), name, code, status));
      for (const f of filesIn(d)) if (/\.md$/i.test(f) && !f.startsWith('_')) books.push(stubBook(r, ri, path.join(d, f), code, status));
    }
  }

  // Which run each topic belongs to: the marathon-research state file names the run of each wave.
  const state = readJsonSmall(r.state);
  const waveRun = new Map();
  if (state && Array.isArray(state.waves)) {
    for (const w of state.waves) if (w && typeof w.slug === 'string') waveRun.set(w.slug, String(state.sessionId || ''));
  }

  // Run summary books.
  const runBooks = [];
  const runDir = path.join(r.path, 'runs');
  for (const f of filesIn(runDir)) {
    if (!/\.md$/i.test(f) || f.startsWith('_')) continue;
    const file = path.join(runDir, f);
    const t = head(file, 8192);
    const { data, body } = frontMatter(t);
    const run = String(data.run || path.basename(f, '.md'));
    const title = data.title || firstHeading(body) || `Run ${run}`;
    const topics = Array.isArray(data.topics) ? data.topics : [];
    const b = {
      id: idFor(ri, 'r', path.basename(f, '.md')), slug: path.basename(f, '.md'), title, kind: 'run-summary', status: 'finished',
      date: dateOf(data.date) || dateOf(run) || dateOf(f), run, sources: 0, lines: lineCount(file), root: ri, rootPath: r.path,
      pages: [{ kind: 'run-summary', name: 'The run summary', file }], text: `${title} ${run} ${body.slice(0, 1500)}`,
      topics, council: typeof data.council === 'string' ? data.council : null,
    };
    runBooks.push(b);
  }
  const runOfTopic = new Map();
  for (const b of runBooks) for (const s of b.topics) runOfTopic.set(s, b.run);

  // Council proceedings.
  const councilBooks = [];
  const cDir = path.join(r.path, r.council);
  const cFiles = filesIn(cDir);
  for (const f of cFiles) {
    const m = /^council-summary-(.+)\.md$/i.exec(f);
    if (!m) continue;
    const file = path.join(cDir, f);
    const t = head(file, PAGE_CAP);
    const pages = [{ kind: 'council', name: 'The council summary', file }];
    const transcript = `council-transcript-${m[1]}.md`;
    if (cFiles.includes(transcript)) pages.push({ kind: 'transcript', name: 'The transcript', file: path.join(cDir, transcript) });
    const runBook = runBooks.find((rb) => rb.council === f) || null;
    const run = runBook ? runBook.run : null;
    const heading = firstHeading(t).replace(/^marathon-research\s+/i, '').replace(/\s+—\s+/g, ': ');
    councilBooks.push({
      id: idFor(ri, 'c', path.basename(f, '.md')), slug: path.basename(f, '.md'),
      title: runBook ? `Council notes: ${runBook.title}` : heading || `Council of ${dateOf(m[1]) || m[1]}`, kind: 'council', status: 'finished',
      date: dateOf(m[1]), run, sources: 0, lines: lineCount(file), root: ri, rootPath: r.path, pages, text: `${firstHeading(t)} ${t.slice(0, 1500)}`,
      body: t,
    });
  }

  // Summary cards, joined to their topics.
  const topicsBySlug = new Map(books.map((b) => [b.slug, b]));
  const links = indexLinks(r.path);
  const sDir = path.join(r.path, 'summaries');
  for (const f of filesIn(sDir)) {
    if (!/\.md$/i.test(f) || f.startsWith('_') || /\.draft\.md$/i.test(f)) continue;
    const name = path.basename(f, '.md');
    const file = path.join(sDir, f);
    const t = head(file, 16384);
    let slug = links.get(name);
    if (!slug || !topicsBySlug.has(slug)) {
      slug = [...topicsBySlug.keys()].find((s) => s.replace(/^\d{4}-\d{2}-\d{2}-/, '') === name || s === name) || null;
    }
    if (!slug) {
      const counts = new Map();
      for (const mm of t.matchAll(/(\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*)/g)) if (topicsBySlug.has(mm[1])) counts.set(mm[1], (counts.get(mm[1]) || 0) + 1);
      slug = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || null;
    }
    const card = { kind: 'card', name: PAGE_NAMES.card, file };
    const topic = slug && topicsBySlug.get(slug);
    if (topic) {
      topic.card = card;
      topic.text += ` ${t.slice(0, 3000)}`;
    } else {
      const title = firstHeading(t).replace(/\s+[—-]+\s+Summary$/i, '').replace(/\s+Summary$/i, '') || words(name);
      books.push({
        id: idFor(ri, 's', name), slug: name, title, kind: 'topic', status: 'finished', date: dateOf(t.slice(0, 2000)), run: null,
        sources: 0, lines: lineCount(file), root: ri, rootPath: r.path, pages: [], card, text: `${title} ${name} ${t.slice(0, 3000)}`,
      });
    }
  }

  // Each topic: its run, its summary card, and the council notes that name it.
  for (const b of books) {
    b.run = runOfTopic.get(b.slug) || waveRun.get(b.slug) || null;
    if (b.card) b.pages.push(b.card);
    const short = b.slug.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    for (const c of councilBooks) {
      const named = c.body.includes(b.slug) || (short.length >= 8 && new RegExp(`(^|[^A-Za-z0-9-])${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9-]|$)`).test(c.body));
      if (named) {
        b.pages.push({ kind: 'council', name: PAGE_NAMES.council, file: c.pages[0].file });
        if (!b.run && c.run) b.run = c.run;
      }
    }
    delete b.card;
  }
  for (const c of councilBooks) delete c.body;
  return books.concat(councilBooks, runBooks);
}

/* ------------------------------------------------------------------ the index */

function buildIndex(roots) {
  const books = [];
  (roots || []).forEach((r, ri) => { for (const b of scanRoot(r, ri)) books.push(Object.assign(b, { rootLabel: r.label, example: Boolean(r.example) })); });
  const byId = new Map();
  for (const b of books) if (!byId.has(b.id)) byId.set(b.id, b);
  return { books: [...byId.values()], byId, roots: roots || [], builtAt: Date.now() };
}

let cache = null;
/** The index for these roots, rebuilt when it is older than a few seconds. */
function get(roots, opts) {
  const key = JSON.stringify((roots || []).map((r) => [r.path, r.council, r.state]));
  const ttl = opts && opts.ttlMs != null ? opts.ttlMs : TTL_MS;
  if (cache && cache.key === key && Date.now() - cache.index.builtAt < ttl) return cache.index;
  cache = { key, index: buildIndex(roots) };
  return cache.index;
}
function invalidate() { cache = null; }

/* ------------------------------------------------------------------ views */

function monthLabel(date) {
  const d = dateOf(date);
  if (!d) return null;
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

function longDate(date) {
  const d = dateOf(date);
  return d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : null;
}

/** [section id, label, sort key] for a book in one arrangement. */
function sectionOf(b, arrange, runTitles) {
  if (arrange === 'status') return [b.status, STATUS_LABEL[b.status], String(STATUS_ORDER.indexOf(b.status))];
  if (arrange === 'month') {
    const d = dateOf(b.date);
    return d ? [d.slice(0, 7), monthLabel(d), `0-${9999 - Number(d.slice(0, 4))}-${99 - Number(d.slice(5, 7))}`] : ['undated', 'Undated', '9'];
  }
  if (arrange === 'run') {
    if (b.run) {
      const d = dateOf(b.run) || dateOf(b.date) || '0000-00-00';
      return [`run-${b.run}`.replace(/[^A-Za-z0-9._-]/g, '-'), runTitles.get(b.run) || `Run ${b.run}`, `0-${invert(d)}-${b.run}`];
    }
    const d = dateOf(b.date);
    return d ? [`day-${d}`, `Researched ${longDate(d)}`, `1-${invert(d)}`] : ['undated', 'Undated', '9'];
  }
  if (b.kind === 'council') return ['council', 'Council proceedings', '8'];
  if (b.kind === 'run-summary') return ['runs', 'Run summaries', '9'];
  const t = b.title.toLowerCase().replace(/^(the|a|an)\s+/, '');
  const shelf = LETTER_SHELVES.find((s) => s[2].test(t));
  return [shelf[0], shelf[1], String(LETTER_SHELVES.indexOf(shelf))];
}
/** A date as a string that sorts newest first. */
function invert(d) { return String(99999999 - Number(String(d).replace(/-/g, '').slice(0, 8))).padStart(8, '0'); }

function queryWords(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

function publicBook(b, section) {
  return {
    id: b.id, title: b.title, section, kind: b.kind, status: b.status, date: b.date, run: b.run,
    sources: b.sources, lines: b.lines, pages: b.pages.length,
  };
}

/** { sections, books, examples } for GET /api/library. Throws (status 400) on an arrangement it does not know. */
function shelves(index, opts) {
  const o = opts || {};
  const arrange = o.arrange || 'topic';
  if (!ARRANGEMENTS.includes(arrange)) throw Object.assign(new Error(`"${arrange}" is not a way to arrange the shelves. Use ${ARRANGEMENTS.join(', ')}.`), { status: 400 });
  const qw = queryWords(o.q);
  const runTitles = new Map(index.books.filter((b) => b.kind === 'run-summary').map((b) => [b.run, b.title]));
  const picked = index.books.filter((b) => {
    if (!qw.length) return true;
    const hay = `${b.title} ${b.slug} ${b.run || ''} ${b.kind}`.toLowerCase();
    return qw.every((w) => hay.includes(w));
  });
  const sections = new Map();
  const rows = picked.map((b) => {
    const [id, label, key] = sectionOf(b, arrange, runTitles);
    if (!sections.has(id)) sections.set(id, { id, label, count: 0, key });
    sections.get(id).count += 1;
    return { b, id, key };
  });
  const byTitle = (a, b) => a.b.title.localeCompare(b.b.title);
  const newest = (a, b) => String(b.b.date || '').localeCompare(String(a.b.date || '')) || byTitle(a, b);
  rows.sort((a, b) => a.key.localeCompare(b.key) || (arrange === 'topic' ? byTitle(a, b) : newest(a, b)));
  return {
    sections: [...sections.values()].sort((a, b) => a.key.localeCompare(b.key)).map(({ id, label, count }) => ({ id, label, count })),
    books: rows.map((r) => publicBook(r.b, r.id)),
    examples: index.roots.length > 0 && index.roots.every((r) => r.example),
  };
}

const rel = (b, file) => path.relative(b.rootPath, file).split(path.sep).join('/');

function bookView(index, id) {
  const b = index.byId.get(String(id));
  if (!b) return null;
  return {
    id: b.id, title: b.title, kind: b.kind, status: b.status, date: b.date, run: b.run,
    pages: b.pages.map((p, i) => ({ n: i + 1, name: p.name, kind: p.kind, file: rel(b, p.file) })),
  };
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/** True when `file` (after following every link) is inside `root` (after the same). */
function inside(root, file) {
  try {
    const r = fs.realpathSync.native(root);
    const f = fs.realpathSync.native(file);
    const d = path.relative(r, f);
    return d !== '' && !path.isAbsolute(d) && d.split(path.sep)[0] !== '..';
  } catch (_) { return false; }
}

/** One page of a book, as markdown. Only a plain file inside the book's own root, at most 512 KB. */
function readPage(index, id, n) {
  const b = index.byId.get(String(id));
  if (!b) throw httpError(404, 'There is no such book on the shelves.');
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > b.pages.length) throw httpError(404, `That book has pages 1 to ${b.pages.length}.`);
  const p = b.pages[num - 1];
  let st;
  try { st = fs.lstatSync(p.file); } catch (_) { throw httpError(404, 'That page is no longer on the shelf.'); }
  if (!st.isFile() || !inside(b.rootPath, p.file)) throw httpError(403, 'That page is outside the library, so it stays closed.');
  if (st.size > PAGE_CAP) throw httpError(413, `That page is too long to open here (over 512 KB). Its file is ${rel(b, p.file)}.`);
  const text = fs.readFileSync(p.file, 'utf8').replace(/^\uFEFF/, '');
  return { n: num, name: p.name, kind: p.kind, markdown: frontMatter(text).body };
}

/** Books that answer a question, best first: words in the title count most, then the folder name, then the text. */
function find(index, q) {
  const qw = queryWords(q);
  if (!qw.length) return [];
  const out = [];
  for (const b of index.books) {
    const title = b.title.toLowerCase();
    const slug = b.slug.toLowerCase();
    const text = String(b.text || '').toLowerCase();
    let score = 0;
    let hits = 0;
    for (const w of qw) {
      const stem = w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;
      const s = (title.includes(stem) ? 3 : 0) + (slug.includes(stem) ? 2 : 0) + (text.includes(stem) ? 1 : 0);
      if (s) hits += 1;
      score += s;
    }
    if (!hits) continue;
    score = score * (hits / qw.length) + (b.kind === 'topic' ? 0.5 : 0) + (b.status === 'finished' ? 0.25 : 0);
    out.push({ book: b, score });
  }
  return out.sort((a, b) => b.score - a.score || String(b.book.date || '').localeCompare(String(a.book.date || '')));
}

module.exports = {
  get, invalidate, buildIndex, shelves, bookView, readPage, find, frontMatter, inside,
  ARRANGEMENTS, PAGE_CAP, TOPIC_RE,
};

/* ------------------------------------------------------------------ the CLI */

if (require.main === module) {
  const config = require('./config');
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] || '') : null; };
  const json = argv.includes('--json');
  let cfg;
  try { cfg = config.load(); } catch (e) { out(e.message); process.exit(1); }
  const index = get(cfg.roots);
  const cmd = argv[0];

  if (cmd === 'find') {
    const q = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ');
    if (!q.trim()) { out('Say what to look for: node engine/library.js find "frost dates"'); process.exit(2); }
    const hits = find(index, q).slice(0, 5);
    if (json) { out(JSON.stringify(hits.map((h) => Object.assign(bookView(index, h.book.id), { score: h.score, root: h.book.rootPath })), null, 2)); process.exit(0); }
    if (!hits.length) { out(`Nothing on the shelves for "${q}". Louise can research it: add it to her queue.`); process.exit(1); }
    hits.forEach((h, i) => {
      const b = h.book;
      out(`${i + 1}. ${b.title}  [${b.kind}, ${STATUS_LABEL[b.status].toLowerCase()}${b.date ? `, ${b.date}` : ''}${b.run ? `, run ${b.run}` : ''}]  id ${b.id}`);
      const card = b.pages.find((p) => p.kind === 'card');
      if (card) out(`   Summary card: ${card.file}`);
      for (const p of b.pages.filter((x) => x !== card)) out(`   ${p.name}: ${p.file}`);
    });
    process.exit(0);
  }

  if (cmd === 'list' || !cmd) {
    let view;
    try { view = shelves(index, { arrange: flag('arrange') || 'topic', q: flag('q') || '' }); } catch (e) { out(e.message); process.exit(2); }
    if (json) { out(JSON.stringify(view, null, 2)); process.exit(0); }
    out(`${index.books.length} books on Louise's shelves${view.examples ? ' (the examples)' : ''}, from ${cfg.roots.map((r) => r.path).join(', ')}`);
    for (const s of view.sections) {
      out('');
      out(`${s.label} (${s.count})`);
      for (const b of view.books.filter((x) => x.section === s.id)) {
        out(`  ${b.title}  [${b.kind}, ${STATUS_LABEL[b.status].toLowerCase()}${b.date ? `, ${b.date}` : ''}, ${b.pages} page${b.pages === 1 ? '' : 's'}]  id ${b.id}`);
      }
    }
    process.exit(0);
  }

  out('Use: node engine/library.js find "<question>"   or   node engine/library.js list [--arrange topic|run|month|status] [--q <words>] [--json]');
  process.exit(2);
}
