'use strict';

/**
 * server.test.js — dashboard/server.js, on ports the system hands out: /health with no token; every API route in
 * SPEC.md; a foreign Host refused; a POST that is not JSON, or comes from another site, refused; traversal refused on
 * the API and on every static folder; dot-files and files outside public/, art/ and brand/ never served; the page
 * served with its Content-Security-Policy. Then the real `node dashboard/server.js`, started from a temporary copy
 * of her folder: it listens on 127.0.0.1 only and writes its pid to dashboard/.pid.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('../dashboard/server');
const library = require('../engine/library');
const { makeLibrary, tmpdir, write } = require('./fixtures');

let server;
let port;
let lib;

function req(method, p, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: o.port || port, method, path: p, headers: Object.assign({ Host: `127.0.0.1:${o.port || port}` }, o.headers) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = text;
        try { body = JSON.parse(text); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body, text });
      });
    });
    r.on('error', reject);
    if (o.body != null) r.write(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    r.end();
  });
}
const post = (p, body, headers) => req('POST', p, { body, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) });

before(async () => {
  lib = makeLibrary();
  write(path.join(lib.home, 'dashboard', 'public', 'index.html'), '<!doctype html><title>Louise</title>');
  write(path.join(lib.home, 'dashboard', 'public', 'app.js'), 'console.log(1)');
  write(path.join(lib.home, 'dashboard', 'public', '.hidden.js'), 'secret');
  write(path.join(lib.home, 'dashboard', '.pid'), '1');
  write(path.join(lib.home, 'art', 'scenes', 'idle.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(lib.home, 'brand', 'copy.json'), '{}');
  write(path.join(lib.home, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(lib.home, 'louise.config.json'), '{"secret":true}');
  library.invalidate();
  server = createServer({ home: lib.home, roots: lib.roots, phoneHost: 'louise.example-tailnet.ts.net' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

test('/health answers {"ok":true}, no token, and a foreign Host is refused everywhere', async () => {
  const h = await req('GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.text, '{"ok":true}');
  for (const host of ['evil.example.org', `evil.example.org:${port}`, '127.0.0.2', '']) {
    for (const p of ['/health', '/api/stage', '/', '/api/library']) {
      const r = await req('GET', p, { headers: { Host: host } });
      assert.equal(r.status, 403, `${host} ${p}`);
    }
  }
  for (const host of ['localhost', `localhost:${port}`, 'louise.example-tailnet.ts.net']) {
    assert.equal((await req('GET', '/health', { headers: { Host: host } })).status, 200, host);
  }
});

test('the stage, the shelves, a book and its pages', async () => {
  const s = await req('GET', '/api/stage');
  assert.equal(s.status, 200);
  assert.deepEqual(Object.keys(s.body), ['stage', 'topic', 'run', 'step', 'since', 'note']);
  const shelves = await req('GET', '/api/library?arrange=month');
  assert.equal(shelves.status, 200);
  assert.ok(shelves.body.sections.length > 0 && shelves.body.books.length > 0);
  assert.equal((await req('GET', '/api/library?arrange=colour')).status, 400);
  const q = await req('GET', '/api/library?q=frost');
  assert.ok(q.body.books.every((b) => /frost/i.test(b.title) || b.kind !== 'topic'));

  const book = await req('GET', '/api/book/0-t-2026-09-01-frost-dates');
  assert.equal(book.status, 200);
  assert.deepEqual(Object.keys(book.body), ['id', 'title', 'kind', 'status', 'date', 'run', 'pages']);
  assert.deepEqual(Object.keys(book.body.pages[0]), ['n', 'name', 'kind', 'file']);
  const page = await req('GET', '/api/book/0-t-2026-09-01-frost-dates/page/2');
  assert.equal(page.status, 200);
  assert.equal(page.body.n, 2);
  assert.match(page.body.markdown, /average/);
  assert.equal((await req('GET', '/api/book/0-t-nope')).status, 404);
  assert.equal((await req('GET', '/api/book/0-t-2026-09-01-frost-dates/page/99')).status, 404);
});

test('traversal is refused on the API and on every static folder', async () => {
  const tries = [
    '/api/book/..%2f..%2flouise.config.json/page/1', '/api/book/0-t-..%2f..%2fengine/page/1', '/api/book/%2e%2e/page/1',
    '/..%2flouise.config.json', '/%2e%2e/louise.config.json', '/art/..%2f..%2flouise.config.json', '/art/%2e%2e%2fmark.svg',
    '/brand/..%2f..%2flouise.config.json', '/brand/..%5c..%5clouise.config.json', '/louise.config.json', '/engine/config.js',
    '/dashboard/.pid', '/.pid', '/.hidden.js', '/brand/', '/art/scenes/%00idle.svg',
  ];
  for (const p of tries) {
    const r = await req('GET', p);
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!r.text.includes('secret'), p);
  }
});

test('static files: the page with its policy, its scripts, the art, the brand, her mark', async () => {
  const page = await req('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal((await req('GET', '/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  const art = await req('GET', '/art/scenes/idle.svg');
  assert.equal(art.status, 200);
  assert.match(art.headers['content-security-policy'], /sandbox/);
  assert.equal((await req('GET', '/brand/copy.json')).status, 200);
  assert.equal((await req('GET', '/mark.svg')).status, 200);
  assert.equal((await req('GET', '/art.svg')).status, 404, 'not there, so not found');
  assert.equal((await req('DELETE', '/app.js')).status, 405);
});

test('a POST must be JSON from her own page; fetch sends her fetching; a request goes on her list', async () => {
  assert.equal((await req('POST', '/api/fetch', { body: 'q=frost', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403);
  assert.equal((await req('POST', '/api/request', { body: '{"topic":"Frost dates"}', headers: { 'Content-Type': 'text/plain' } })).status, 403);
  assert.equal((await post('/api/fetch', { q: 'frost' }, { Origin: 'http://evil.example.org' })).status, 403);
  assert.equal((await post('/api/fetch', { q: 'frost' }, { Origin: 'null' })).status, 403);
  assert.equal((await post('/api/fetch', { q: 'frost' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/fetch', '{not json')).status, 400);
  assert.equal((await post('/api/fetch', [1])).status, 400);
  assert.equal((await post('/api/fetch', { q: '' })).status, 400);
  assert.equal((await post('/api/fetch', 'x'.repeat(20 * 1024))).status, 413);

  const f = await post('/api/fetch', { q: 'frost dates' }, { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(f.status, 200);
  assert.equal(f.body.book, '0-t-2026-09-01-frost-dates');
  assert.ok(f.body.matches.includes('0-t-2026-09-01-frost-dates'));
  const s = await req('GET', '/api/stage');
  assert.equal(s.body.stage, 'fetching');
  assert.equal(s.body.book, '0-t-2026-09-01-frost-dates');
  const none = await post('/api/fetch', { q: 'volcano insurance' });
  assert.deepEqual(none.body, { book: null, matches: [] });

  assert.deepEqual((await req('GET', '/api/requests')).body, { requests: [] });
  assert.deepEqual((await post('/api/request', { topic: 'When can I plant tomatoes?', framing: 'Raised beds.' })).body, { queued: 1 });
  assert.deepEqual((await post('/api/request', { topic: 'Repotting a fig' })).body, { queued: 2 });
  assert.equal((await post('/api/request', { topic: 'x' })).status, 400);
  const list = await req('GET', '/api/requests');
  assert.deepEqual(list.body.requests.map((r) => r.topic), ['When can I plant tomatoes?', 'Repotting a fig']);
  assert.match(fs.readFileSync(path.join(lib.home, 'requests', 'queue.md'), 'utf8'), /^# Research Queue\n\n## When can I plant tomatoes\?/);
  assert.equal((await req('GET', '/api/fetch')).status, 405);
});

/** A port nothing is using, from the system. */
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

test('node dashboard/server.js listens on 127.0.0.1 only and keeps its pid in dashboard/.pid', async (t) => {
  const repo = path.join(__dirname, '..');
  const home = tmpdir('run');
  for (const d of ['engine', 'dashboard', 'brand']) fs.cpSync(path.join(repo, d), path.join(home, d), { recursive: true, filter: (s) => !/[\\/]\.pid$|dashboard\.log$/.test(s) });
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(home, 'package.json'));
  const p = await freePort();
  const lib2 = makeLibrary();
  fs.writeFileSync(path.join(home, 'louise.config.json'), JSON.stringify({ port: p, library: { roots: [{ label: 'T', path: lib2.root }] } }));
  const child = spawn(process.execPath, [path.join('dashboard', 'server.js')], { cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill(); } catch (_) { /* already gone */ } });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const until = Date.now() + 10000;
  let up = false;
  while (Date.now() < until && !up) {
    try { up = (await req('GET', '/health', { port: p })).status === 200; } catch (_) { await new Promise((r) => setTimeout(r, 150)); }
  }
  assert.ok(up, `the server did not come up: ${out}`);
  assert.equal(fs.readFileSync(path.join(home, 'dashboard', '.pid'), 'utf8').trim(), String(child.pid));
  assert.match(out, new RegExp(`127\\.0\\.0\\.1:${p}`));

  const outward = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (outward) {
    const reached = await new Promise((resolve) => {
      const s = net.connect({ host: outward.address, port: p, timeout: 1500 }, () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
    assert.equal(reached, false, `reachable on ${outward.address}`);
  } else t.diagnostic('no outward network address here; the 127.0.0.1-only check was skipped');

  child.kill();
  await new Promise((r) => child.once('exit', r));
});
