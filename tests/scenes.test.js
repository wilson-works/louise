// tests/scenes.test.js: her seven desk scenes (art/<stage>.svg; presenting is shown by the page, never a stage), the
// shelving flight's hook, and the runbook lines that keep her screen strip moving.
// Contract under test (art/README.md, "Naming and scoping"; SPEC.md, "The scenes"):
// - each scene is one 640 by 400 SVG with root id lz-<stage>, class lz-scene, role img and its own <title>; every id,
//   CSS rule and keyframe is scoped to the scene; it stops all motion for reduced motion; it carries no script, image,
//   text, foreign object, link, outside reference or event attribute.
// - shelving has no cart (the owner, 2026-10-05). The book she carries is lz-shelving-newbook, with data-loop-ms and
//   data-placed-ms (when in the loop it is in its gap); the page's flight starts from an id ending -newbook, never
//   from a cart.
// - idle and council are different pictures with different titles (at rest she reads; in the reading room she studies).
// - in the runbook, every stage she is set to, but idle, carries a --note or a --topic, so the strip has something new.
// Hermetic: reads the repo's files only. No network, no ports.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PREFIX = { researching: 'lz-res-', council: 'lz-cou-', distill: 'lz-dis-', shelving: 'lz-shl-', fetching: 'lz-fet-', idle: 'lz-idl-', presenting: 'lz-pre-' };

// The CSS of a scene with its @keyframes blocks taken out, and the keyframe names.
function cssParts(style) {
  const frames = [];
  let rules = '';
  for (let i = 0; i < style.length;) {
    const m = /^@keyframes\s+([\w-]+)\s*\{/.exec(style.slice(i));
    if (!m) { rules += style[i]; i += 1; continue; }
    frames.push(m[1]);
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < style.length; j += 1) {
      if (style[j] === '{') depth += 1;
      if (style[j] === '}') { depth -= 1; if (depth === 0) break; }
    }
    i = j + 1;
  }
  const selectors = [...rules.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
  return { frames, selectors };
}

for (const [stage, prefix] of Object.entries(PREFIX)) {
  test(`${stage}.svg is one scoped, safe scene with its own title`, () => {
    const svg = read(`art/${stage}.svg`);
    const root = `lz-${stage}`;
    const open = /^<svg\b[^>]*>/.exec(svg.trim());
    assert.ok(open, 'starts with its <svg> element');
    for (const attr of ['viewBox="0 0 640 400"', `id="${root}"`, 'class="lz-scene"', 'role="img"', `aria-labelledby="${root}-title"`]) {
      assert.ok(open[0].includes(attr), `${stage}: ${attr}`);
    }
    const title = new RegExp(`<title id="${root}-title">([^<]{10,})</title>`).exec(svg);
    assert.ok(title, `${stage}: a <title> that says what she is doing`);
    assert.doesNotMatch(svg, /<(script|image|foreignObject|text|a|iframe)\b/i, `${stage}: nothing but drawing`);
    assert.doesNotMatch(svg, /\s(xlink:)?href="(?!#)/i, `${stage}: no outside references`);
    assert.doesNotMatch(svg, /\son[a-z]+=/i, `${stage}: no event attributes`);
    assert.doesNotMatch(svg, /url\((?!#)/i, `${stage}: no outside url()`);
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${stage}: no id twice`);
    const stray = ids.filter((id) => !id.startsWith(prefix) && !id.startsWith(`${root}-`) && id !== root);
    assert.deepEqual(stray, [], `${stage}: every id is scoped`);
    const style = (/<style>([\s\S]*?)<\/style>/.exec(svg) || [])[1] || '';
    const { frames, selectors } = cssParts(style);
    assert.deepEqual(frames.filter((f) => !f.startsWith(prefix)), [], `${stage}: every keyframe is scoped`);
    assert.deepEqual(selectors.filter((s) => !s.startsWith(`#${root}`)), [], `${stage}: every rule starts with #${root}`);
    assert.match(style.replace(/\s+/g, ''), new RegExp(`@media\\(prefers-reduced-motion:reduce\\)\\{#${root}\\*\\{animation:none!important\\}\\}`), `${stage}: reduced motion stops every animation`);
  });
}

test('shelving: no cart; the new book carries the loop and the moment it is in its gap', () => {
  const svg = read('art/shelving.svg');
  assert.doesNotMatch(svg, /id="[^"]*cart[^"]*"/i, 'no cart in the scene');
  const m = /<g\b[^>]*\bid="lz-shelving-newbook"[^>]*>/.exec(svg);
  assert.ok(m, 'the book she carries is lz-shelving-newbook');
  const loop = Number((/data-loop-ms="(\d+)"/.exec(m[0]) || [])[1]);
  const placed = Number((/data-placed-ms="(\d+)"/.exec(m[0]) || [])[1]);
  assert.ok(loop >= 3000 && loop <= 15000, `a calm loop: ${loop} ms`);
  assert.ok(placed >= 0 && placed < loop, `placed inside the loop: ${placed} of ${loop}`);
  const durations = [...svg.matchAll(/animation:[^;}]*?\s([\d.]+)(m?s)\b/g)].map((d) => Math.round(Number(d[1]) * (d[2] === 's' ? 1000 : 1)));
  assert.ok(durations.includes(loop), 'at least one of its animations runs on that loop, so the page can read the phase');
});

test("the page's flight starts from the new book, never from a cart", () => {
  const app = read('dashboard/public/app.js');
  assert.match(app, /\[id\$="-newbook"\]/);
  assert.doesNotMatch(app, /-cart/);
  assert.match(app, /dataset\.loopMs/);
  assert.match(app, /dataset\.placedMs/);
  assert.match(read('dashboard/public/index.html'), /<script src="crt\.js" defer><\/script>\s*<script src="app\.js" defer><\/script>/, 'crt.js loads before app.js');
});

test('presenting: she holds the new book out; the shelving flight never starts from it', () => {
  const svg = read('art/presenting.svg');
  assert.match((/<title[^>]*>([^<]+)<\/title>/.exec(svg) || [])[1], /book/i);
  assert.doesNotMatch(svg, /id="[^"]*-newbook"/, 'only the shelving scene launches flights');
  const app = read('dashboard/public/app.js');
  assert.match(app, /'presenting'/, 'the page shows it');
  assert.match(app, /\/api\/seen/, 'and tells the server when the book was closed the first time');
});

test('idle and council are different pictures', () => {
  const title = (s) => (/<title[^>]*>([^<]+)<\/title>/.exec(read(`art/${s}.svg`)) || [])[1];
  assert.notEqual(title('idle'), title('council'));
  assert.match(title('idle'), /read/i, 'at rest she reads a book');
});

test('in the runbook, every working stage she is set to carries a note or a topic', () => {
  const md = read('CLAUDE.md');
  const book = md.slice(md.indexOf('## The runbook'), md.indexOf('## A run started from her dashboard'));
  const sets = [...book.matchAll(/node engine\/stage\.js set (\w+)([^`]*)`/g)];
  const seen = new Set(sets.map((m) => m[1]));
  for (const stage of ['researching', 'council', 'distill', 'shelving', 'idle']) assert.ok(seen.has(stage), `the runbook sets ${stage}`);
  for (const [line, stage, rest] of sets) {
    if (stage === 'idle') continue;
    assert.match(rest, /--(note|topic) "/, `${line} says what she is on`);
  }
  const council = sets.filter((m) => m[1] === 'council');
  assert.ok(council.length >= 3, 'the reading room moves the strip as it goes, not once');
  assert.ok(council.every((m) => /--step \d\/\d/.test(m[2])), 'each reading-room step is numbered');
});
