'use strict';

/**
 * dashboard/server.js — Louise's dashboard: her page and the JSON API it reads. Node's built-ins only.
 *
 *   node dashboard/server.js        (from her folder; "start" in agent.json says so)
 *
 * Who it answers, and what it may touch:
 *   - Listens on 127.0.0.1 only, on the port from engine/config.js (louise.config.json, else probe.port in agent.json,
 *     else 7540). Writes its pid to dashboard/.pid while it runs.
 *   - Answers only Host 127.0.0.1, localhost, or the host in her own door.phone. Any other Host gets 403, so a page
 *     elsewhere cannot point a name of its own at this port and read her library.
 *   - A POST must be JSON (application/json) and, when the browser says where it came from (Origin, Sec-Fetch-Site),
 *     from this page. A page on another site cannot add to her list or send her fetching.
 *   - Reads library pages only inside the configured library roots (their real paths, links followed and checked),
 *     at most 512 KB a page. Writes only state/ (her stage) and requests/ (her list).
 *
 * Files it serves (GET and HEAD), each only from inside its own folder, never a dot-file:
 *   /                 dashboard/public/index.html (a short holding page until it exists)
 *   /<file>           dashboard/public/<file>      (app.js, app.css, ...)
 *   /art/<file>       art/<file>                   (the scenes and their parts)
 *   /brand/<file>     brand/<file>                 (copy.json, tokens.css, ...)
 *   /art.svg, /mark.svg   her office-door figure and her mark
 * The page gets a Content-Security-Policy of 'self' only: scripts and styles from these files (inline style
 * attributes are allowed, inline scripts are not), images from here or data: URLs, nothing from other sites.
 *
 * The API (SPEC.md):
 *   GET  /health                         {"ok":true}, no token, ever: the office probes it
 *   GET  /api/stage                      { stage, topic, run, step, since, note } (+ book while fetching)
 *   GET  /api/library?arrange=&q=        { sections: [{ id, label, count }], books: [...], examples }
 *   GET  /api/book/<id>                  { id, title, kind, status, date, run, pages: [{ n, name, kind, file }] }
 *   GET  /api/book/<id>/page/<n>         { n, name, kind, markdown }
 *   POST /api/fetch    { q }             { book, matches }, and her stage goes to fetching
 *   POST /api/request  { topic, framing }  { queued: n }, appended to requests/queue.md
 *   GET  /api/requests                   { requests: [{ topic, framing, at }] }
 * An error is { "error": "<a plain sentence>" } with a 4xx status.
 *
 *   createServer(opts)   the server, not yet listening (the tests use it). opts { home, roots, phoneHost, port }
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('../engine/config');
const library = require('../engine/library');
const stage = require('../engine/stage');
const fetcher = require('../engine/fetch');
const requests = require('../engine/requests');

const HOME = path.resolve(__dirname, '..');
const BODY_MAX = 16 * 1024;
const STATIC_MAX = 4 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox";
const HOLDING_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Louise</title></head><body style="font-family: Georgia, serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Louise is in</h1><p>Her dashboard page is not here yet, but her library is open: try <a href="/api/library">/api/library</a>
and <a href="/api/stage">/api/stage</a>.</p></body></html>`;

function send(res, status, body, headers) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, Object.assign({
    'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  }, headers));
  res.end(res.req.method === 'HEAD' ? undefined : buf);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
const fail = (res, status, message) => json(res, status, { error: message });

/** A file under `base` named by URL path parts, or null when the parts are not a plain path inside it. */
function within(base, parts) {
  if (!parts.length || parts.some((p) => !p || p.startsWith('.') || /[\\/:\0]/.test(p))) return null;
  const file = path.join(base, ...parts);
  let st;
  try { st = fs.lstatSync(file); } catch (_) { return null; }
  if (!st.isFile() || st.size > STATIC_MAX || !library.inside(base, file)) return null;
  return file;
}

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext];
  if (!type) { fail(res, 404, 'Not found.'); return; }
  const headers = { 'Content-Type': type };
  if (ext === '.html') headers['Content-Security-Policy'] = PAGE_CSP;
  if (ext === '.svg') headers['Content-Security-Policy'] = SVG_CSP;
  send(res, 200, fs.readFileSync(file), headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_MAX) { reject(Object.assign(new Error('That is more than Louise can take in one go.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createServer(opts) {
  const o = opts || {};
  const home = path.resolve(o.home || HOME);
  const roots = o.roots;
  const stateFile = stage.stageFile(home);
  const queueFile = requests.queueFile(home);
  const hosts = new Set(['127.0.0.1', 'localhost']);
  if (o.phoneHost) hosts.add(String(o.phoneHost).toLowerCase());
  const dirs = { public: path.join(home, 'dashboard', 'public'), art: path.join(home, 'art'), brand: path.join(home, 'brand') };

  /** A POST from a page on another site, or not as JSON, is refused. */
  function postRefused(req) {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'Send this as JSON (Content-Type: application/json).';
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site && site !== 'same-origin' && site !== 'none') return 'Only Louise\'s own page can ask her for that.';
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let h = null;
      try { h = new URL(origin).hostname.toLowerCase(); } catch (_) { /* unreadable: refused below */ }
      if (!h || !hosts.has(h)) return 'Only Louise\'s own page can ask her for that.';
    } else if (origin === 'null') return 'Only Louise\'s own page can ask her for that.';
    return null;
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    const index = () => library.get(roots);

    if (p === '/api/stage' && m === 'GET') return json(res, 200, stage.current(stateFile, roots));
    if (p === '/api/library' && m === 'GET') {
      return json(res, 200, library.shelves(index(), { arrange: url.searchParams.get('arrange') || 'topic', q: url.searchParams.get('q') || '' }));
    }
    if (p === '/api/requests' && m === 'GET') return json(res, 200, { requests: requests.list(queueFile) });
    let bm = /^\/api\/book\/([A-Za-z0-9._-]{1,200})$/.exec(p);
    if (bm && m === 'GET') {
      const v = library.bookView(index(), bm[1]);
      return v ? json(res, 200, v) : fail(res, 404, 'There is no such book on the shelves.');
    }
    bm = /^\/api\/book\/([A-Za-z0-9._-]{1,200})\/page\/(\d{1,4})$/.exec(p);
    if (bm && m === 'GET') return json(res, 200, library.readPage(index(), bm[1], Number(bm[2])));

    if ((p === '/api/fetch' || p === '/api/request') && m === 'POST') {
      const refused = postRefused(req);
      if (refused) return fail(res, 403, refused);
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) {
        if (e.status) throw e;
        return fail(res, 400, 'That was not readable JSON.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'Send one JSON object.');
      if (p === '/api/fetch') return json(res, 200, fetcher.fetchBook(body.q, { roots, stateFile }));
      return json(res, 200, requests.add(queueFile, { topic: body.topic, framing: body.framing }));
    }
    if (['/api/stage', '/api/library', '/api/requests', '/api/fetch', '/api/request'].includes(p)) return fail(res, 405, 'That address does not take that kind of request.');
    return fail(res, 404, 'Not found.');
  }

  function statics(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'That address does not take that kind of request.');
    let parts;
    try { parts = url.pathname.split('/').slice(1).map(decodeURIComponent); } catch (_) { return fail(res, 400, 'That address is not readable.'); }
    if (url.pathname === '/') {
      const index = within(dirs.public, ['index.html']);
      return index ? serveFile(res, index) : send(res, 200, HOLDING_PAGE, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP });
    }
    if (url.pathname === '/art.svg' || url.pathname === '/mark.svg') {
      const f = within(home, [url.pathname.slice(1)]);
      return f ? serveFile(res, f) : fail(res, 404, 'Not found.');
    }
    const [first, ...rest] = parts;
    const file = first === 'art' ? within(dirs.art, rest) : first === 'brand' ? within(dirs.brand, rest) : within(dirs.public, parts);
    return file ? serveFile(res, file) : fail(res, 404, 'Not found.');
  }

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!hosts.has(host)) { send(res, 403, 'unknown host', { 'Content-Type': 'text/plain; charset=utf-8' }); return; }
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) { fail(res, 400, 'That address is not readable.'); return; }
    if (url.pathname === '/health') { json(res, 200, { ok: true }); return; }
    const handle = url.pathname.startsWith('/api/') ? api(req, res, url) : Promise.resolve(statics(req, res, url));
    handle.catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      if (e && e.status) { fail(res, e.status, e.message); return; }
      process.stderr.write(`${new Date().toISOString()} ${req.method} ${url.pathname}: ${(e && e.stack) || e}\n`);
      fail(res, 500, "Something went wrong on my end, and I couldn't do that. Try again in a moment. If it keeps happening, the details are in my log.");
    });
  });
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  let cfg;
  try { cfg = config.load(); } catch (e) { process.stderr.write(`${e.message}\nLouise's dashboard was not started.\n`); process.exit(2); }
  const pidFile = path.join(HOME, 'dashboard', '.pid');
  const server = createServer({ home: cfg.home, roots: cfg.roots, phoneHost: cfg.phoneHost });
  const clearPid = () => {
    try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(pidFile, { force: true }); } catch (_) { /* not ours, or gone */ }
  };
  server.on('error', (e) => {
    process.stderr.write(e.code === 'EADDRINUSE'
      ? `Port ${cfg.port} is already in use, so Louise's dashboard did not start. Give her another port: "port" in louise.config.json, or probe.port and door.local in agent.json.\n`
      : `${e.message}\n`);
    process.exit(1);
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
    process.stdout.write(`Louise is on http://127.0.0.1:${cfg.port}/ , her library: ${cfg.roots.map((r) => r.path).join(', ')}\n`);
    for (const n of cfg.notes) process.stdout.write(`Note: ${n}\n`);
    let manifestPort = null;
    try { manifestPort = JSON.parse(fs.readFileSync(path.join(HOME, 'agent.json'), 'utf8').replace(/^﻿/, '')).probe.port; } catch (_) { /* no agent.json */ }
    if (manifestPort && manifestPort !== cfg.port) {
      process.stdout.write(`Note: her office door looks for her on port ${manifestPort} (agent.json), but she is on ${cfg.port} (louise.config.json). Make them the same, or the office shows her door shut.\n`);
    }
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearPid(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); });
  process.on('exit', clearPid);
}
