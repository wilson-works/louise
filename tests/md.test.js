// tests/md.test.js: the open book's markdown renderer (dashboard/public/md.js) shows a research file safely.
// Contract under test: everything is escaped first; only a small set of formatting comes back; a link is a link only
// when it is http, https or mailto, and it opens in a new tab with rel="noopener noreferrer"; nothing is loaded from
// elsewhere (images become their alt text). Hermetic: no files, no network, no ports.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('../dashboard/public/md.js');

const render = (s) => md.render(s);

test('raw HTML in a file is shown as text, never as markup', () => {
  const out = render('<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="https://example.org">x</a>');
  assert.ok(!/<script|<img|<a /i.test(out), out);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('only http, https and mailto links become links', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', '//example.org/x']) {
    const out = render(`[click](${bad})`);
    assert.ok(!out.includes('<a '), `${bad} -> ${out}`);
    assert.match(out, /click/);
  }
  const ok = render('[a](https://example.org/a) [b](http://example.org/b) [c](mailto:alex@example.org)');
  assert.equal((ok.match(/<a /g) || []).length, 3, ok);
});

test('every link opens in a new tab with rel noopener', () => {
  const out = render('See [the almanac](https://example.org/almanac), https://example.org/bare and <https://example.org/auto>.');
  const links = out.match(/<a [^>]*>/g) || [];
  assert.equal(links.length, 3, out);
  for (const a of links) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
});

test('a link address cannot break out of its attribute', () => {
  const out = render('[x](https://example.org/"onmouseover="alert(1)) [y](https://example.org/a\'b)');
  assert.ok(!/"\s*onmouseover=/i.test(out), out);
  for (const href of out.match(/href="[^"]*"/g) || []) assert.ok(!/["'<>]/.test(href.slice(6, -1)), href);
});

test('a bare address stops before trailing punctuation and escaped quotes', () => {
  const out = render('Read https://example.org/x. Then "https://example.org/q" too.');
  assert.match(out, /href="https:\/\/example\.org\/x"/);
  assert.ok(!/href="[^"]*&quot;/.test(out), out);
});

test('code is escaped, inline and fenced, and not formatted inside', () => {
  const out = render('Use `<b>**not bold**</b>`.\n\n```\n<div> & **x**\n```');
  assert.match(out, /<code>&lt;b&gt;\*\*not bold\*\*&lt;\/b&gt;<\/code>/);
  assert.match(out, /<pre><code>&lt;div&gt; &amp; \*\*x\*\*<\/code><\/pre>/);
});

test('images are shown as their alt text; nothing is loaded', () => {
  const out = render('![a seed packet](https://example.org/seed.png)');
  assert.ok(!/<img/i.test(out), out);
  assert.match(out, /a seed packet/);
});

test('headings start at level 3, under the book title', () => {
  assert.match(render('# One'), /^<h3>One<\/h3>$/);
  assert.match(render('## Two'), /^<h4>Two<\/h4>$/);
  assert.match(render('###### Six'), /^<h6>Six<\/h6>$/);
});

test('lists nest by indent; tables keep header cells', () => {
  const list = render('- a\n- b\n  - b1\n- c\n\n1. one\n2. two');
  assert.match(list, /<ul><li>a<\/li><li>b<ul><li>b1<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(list, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  const table = render('| Crop | When |\n|---|---|\n| Peas | Early |');
  assert.match(table, /<th scope="col">Crop<\/th>/);
  assert.match(table, /<td>Peas<\/td>/);
});

test('bold, italic and quotes format; snake_case words do not', () => {
  const out = render('**bold** *it* _also_ snake_case_word\n\n> a quote');
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<em>also<\/em>/);
  assert.match(out, /snake_case_word/);
  assert.match(out, /<blockquote><p>a quote<\/p><\/blockquote>/);
});

test('empty or missing input renders nothing', () => {
  assert.equal(render(''), '');
  assert.equal(render(null), '');
  assert.equal(render(undefined), '');
});
