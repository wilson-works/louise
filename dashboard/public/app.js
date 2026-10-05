// app.js: Louise's dashboard (index.html). Plain browser JavaScript, no framework, no build step.
//
// Contract:
// - Copy: every line Louise says comes from /brand/copy.json (keys starting "_" are notes and are skipped). Lines with
//   {topic} or {n} are used only when the page has that value. A few plain labels that are not her voice live in UI
//   below; a "ui" block in copy.json overrides any of them by the same key.
// - Her desk: polls GET /api/stage every 2 s. When the stage changes, the scene from /art/<stage>.svg crossfades in
//   (inline, so the pause button can stop its motion), and a new caption is picked. While she is shelving, books fly
//   from her cart to the shelves. The request form posts /api/request; her list comes from /api/requests.
// - The Library: GET /api/library?arrange=&q= draws one shelf per section with an indicator and its count. Typing in
//   the search box narrows the shelves; "Ask Louise" posts /api/fetch, plays the fetching scene, then opens the book.
// - The open book: a modal dialog. It opens on the Summary card page when the book has one (card first), flips with
//   the buttons, the contents list or the arrow keys, and renders each page with md.js (escaped, then formatted).
// - Reduced motion (or the pause button) stops the scene motion, the flights and the page turns.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STAGES = ['idle', 'researching', 'council', 'distill', 'shelving', 'fetching'];
  const SPINES = ['oxblood', 'green', 'navy', 'mustard', 'plum', 'teal', 'tan', 'slate', 'brown', 'olive'];
  const POLL_MS = 2000;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Plain labels that are not Louise's own lines.
  const UI = {
    pause: 'Pause the scene',
    play: 'Play the scene',
    step: 'Step {n} of {of}',
    ready: 'READY',
    offline: "Her desk can't be reached right now. The page keeps trying.",
    books: '{count} books',
    oneBook: '1 book',
    matches: '{count} books match',
    oneMatch: '1 book matches',
    loading: 'Checking the shelves…',
    libraryError: "The Library can't be reached right now. The page will try again.",
    topicNeeded: 'Write your question first.',
    requestFailed: "That didn't reach her desk. Is Louise's dashboard still running?",
    askNeeded: 'Type what you are looking for, then ask.',
    fetchFailed: "That request didn't reach her. Is Louise's dashboard still running?",
    pageLoading: 'Turning to the page…',
    pageError: "This page couldn't be opened.",
    bookError: "That book couldn't be opened.",
    pageOf: 'Page {n} of {of}',
    date: 'Date',
    run: 'Run',
    status: 'Status',
    sources: 'Sources',
    kind_topic: 'Research topic',
    kind_council: 'Reading-room notes',
    'kind_run-summary': 'Run summary',
    sceneMissing: 'Louise is at her desk.',
    arranged: '{n} shelves, arranged by {by}.',
    oneShelf: '1 shelf, arranged by {by}.',
    examples: 'These are example books, invented so the shelves are not empty. Your own research takes their place.',
  };

  let copy = {};
  const state = {
    stage: null, stageKey: '', stageData: null, offline: 0, paused: false, holdUntil: 0, sceneToken: 0,
    arrange: 'topic', q: '', library: null, libToken: 0, highlight: new Set(), runTitles: new Map(),
    book: null, page: 0, pageToken: 0, opener: null, last: {},
  };

  // ---------------------------------------------------------------- copy
  const get = (path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), copy);
  const ui = (key) => (copy.ui && typeof copy.ui[key] === 'string' ? copy.ui[key] : UI[key]);
  const fmt = (line, vals) => String(line).replace(/\{(\w+)\}/g, (m, k) => (vals[k] != null ? String(vals[k]) : m));

  // One line from a list: only lines whose placeholders the page can fill, never the same line twice running.
  function pick(list, vals, memo) {
    const usable = (Array.isArray(list) ? list : []).filter((l) => typeof l === 'string'
      && [...l.matchAll(/\{(\w+)\}/g)].every((m) => vals[m[1]] != null && vals[m[1]] !== ''));
    if (!usable.length) return '';
    const fresh = usable.length > 1 ? usable.filter((l) => l !== state.last[memo]) : usable;
    const line = fresh[Math.floor(Math.random() * fresh.length)];
    state.last[memo] = line;
    return line;
  }

  // Writes a line into an element as text, with {topic} set in italics like a book title.
  function say(el, line, vals) {
    el.textContent = '';
    String(line).split(/(\{\w+\})/).forEach((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (m && vals[m[1]] != null) {
        if (m[1] === 'topic') { const c = document.createElement('cite'); c.textContent = vals.topic; el.append(c); }
        else el.append(String(vals[m[1]]));
      } else if (part) el.append(part);
    });
  }

  async function loadCopy() {
    try {
      const r = await fetch('/brand/copy.json', { cache: 'no-store' });
      if (r.ok) copy = await r.json();
    } catch (e) { copy = {}; }
    document.querySelectorAll('[data-copy]').forEach((el) => {
      const v = get(el.dataset.copy);
      if (typeof v === 'string') el.textContent = v;
    });
    document.querySelectorAll('[data-copy-placeholder]').forEach((el) => {
      const v = get(el.dataset.copyPlaceholder);
      if (typeof v === 'string') el.placeholder = v;
    });
    if (copy.name) document.title = `${copy.name} · ${copy.title || ''}`;
    $('greeting').textContent = pick(copy.greeting, {}, 'greeting');
  }

  // ---------------------------------------------------------------- network
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  async function postJSON(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const still = () => reduced.matches || state.paused;

  // ---------------------------------------------------------------- her desk: the scene
  const scenes = new Map();

  // Our own SVG files, made safe to place inline anyway: no scripts, no handlers, no outside links.
  function parseScene(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    svg.querySelectorAll('script, foreignObject, image, a, iframe').forEach((n) => n.remove());
    [svg, ...svg.querySelectorAll('*')].forEach((el) => {
      [...el.attributes].forEach((at) => {
        if (/^on/i.test(at.name) || (at.localName === 'href' && !at.value.startsWith('#'))) el.removeAttribute(at.name);
      });
    });
    // Named once, by aria-label from its own <title> (a title that also labels it would be read twice).
    const title = svg.querySelector(':scope > title');
    if (title) { svg.setAttribute('aria-label', title.textContent.trim()); title.remove(); }
    svg.removeAttribute('aria-labelledby');
    svg.setAttribute('role', 'img');
    svg.setAttribute('focusable', 'false');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return svg;
  }

  function sceneFor(stage) {
    if (!scenes.has(stage)) {
      scenes.set(stage, fetch(`/art/${stage}.svg`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : null))
        .then((t) => (t ? parseScene(t) : null))
        .catch(() => null));
    }
    return scenes.get(stage);
  }

  async function showScene(stage) {
    const token = ++state.sceneToken;
    const svg = await sceneFor(stage);
    if (token !== state.sceneToken) return;
    const scene = $('scene');
    scene.dataset.stage = stage;
    const layer = document.createElement('div');
    layer.className = 'scene-layer';
    if (svg) layer.append(document.importNode(svg, true));
    else {
      const p = document.createElement('p');
      p.className = 'scene-missing';
      p.textContent = (copy.stageNames && copy.stageNames[stage]) || ui('sceneMissing');
      layer.append(p);
    }
    const old = [...scene.querySelectorAll('.scene-layer')];
    old.forEach((o) => o.setAttribute('aria-hidden', 'true'));
    scene.append(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layer.classList.add('is-in');
      old.forEach((o) => { o.classList.remove('is-in'); setTimeout(() => o.remove(), 700); });
    }));
  }

  function setPaused(p) {
    state.paused = p;
    $('scene').classList.toggle('is-paused', p);
    $('scene-pause').classList.toggle('is-paused', p);
    document.documentElement.classList.toggle('scene-is-paused', p);
    $('scene-pause-text').textContent = p ? ui('play') : ui('pause');
    if (p) $('flights').textContent = ''; // SC 2.2.2: a book already in the air stops with the scene
    try { localStorage.setItem('louise.paused', p ? '1' : '0'); } catch (e) { /* private mode: not kept */ }
  }

  // ---------------------------------------------------------------- her desk: the stage
  function caption(stage, vals) {
    const names = copy.stageNames || {};
    $('stage-name').textContent = names[stage] || '';
    say($('caption'), pick(copy.stages && copy.stages[stage], vals, `stage-${stage}`), vals);
  }

  function screen(s) {
    const crt = $('crt');
    crt.hidden = false;
    const working = s.stage !== 'idle' && s.topic;
    const ct = $('crt-topic');
    ct.textContent = '';
    if (working) {
      const prompt = document.createElement('span');
      prompt.setAttribute('aria-hidden', 'true');
      prompt.textContent = '> ';
      ct.append(prompt, s.topic);
    } else ct.textContent = ui('ready');
    const step = s.step && Number(s.step.n) > 0 && Number(s.step.of) > 0 ? s.step : null;
    $('crt-step').textContent = working && step ? fmt(ui('step'), { n: step.n, of: step.of }) : '';
    const dots = $('crt-dots');
    dots.textContent = '';
    if (working && step && step.of <= 12) {
      for (let i = 1; i <= step.of; i++) {
        const li = document.createElement('li');
        li.className = i < step.n ? 'is-done' : i === Number(step.n) ? 'is-now' : '';
        dots.append(li);
      }
    }
    $('crt-note').textContent = working && s.note ? s.note : '';
  }

  function applyStage(s) {
    const stage = STAGES.includes(s.stage) ? s.stage : 'idle';
    state.stageData = s;
    screen({ ...s, stage });
    if (Date.now() < state.holdUntil) return; // a fetch the person asked for is playing
    const key = stage === 'fetching' || stage === 'idle' ? `${stage}|` : `${stage}|${s.topic || ''}`;
    if (stage !== state.stage) {
      const was = state.stage;
      state.stage = stage;
      showScene(stage);
      onStageChange(stage, was);
    }
    if (key !== state.stageKey) {
      state.stageKey = key;
      caption(stage, { topic: s.topic || null });
    }
  }

  async function pollStage() {
    try {
      applyStage(await getJSON('/api/stage'));
      state.offline = 0;
      $('desk-offline').textContent = '';
    } catch (e) {
      state.offline += 1;
      if (state.offline >= 2) $('desk-offline').textContent = ui('offline');
      if (!state.stage) applyStage({ stage: 'idle' });
    } finally {
      setTimeout(pollStage, POLL_MS);
    }
  }

  // ---------------------------------------------------------------- shelving: books travel from her cart to the shelves
  let flightTimer = null;
  let flightN = 0;

  function onStageChange(stage, was) {
    clearInterval(flightTimer);
    flightTimer = null;
    if (stage === 'shelving') { flightTimer = setInterval(flyBook, 1300); setTimeout(flyBook, 700); }
    if (was !== null) { loadLibrary(); loadQueue(); }
  }

  function flightTarget() {
    const run = state.stageData && state.stageData.run;
    const books = (state.library && state.library.books) || [];
    const mine = run && books.find((b) => b.run === run);
    const spine = mine && document.querySelector(`.spine[data-id="${CSS.escape(mine.id)}"]`);
    const row = (spine && spine.closest('.shelf-row')) || document.querySelector('.shelf-row') || $('library');
    return row.getBoundingClientRect();
  }

  function flyBook() {
    if (still() || document.hidden) return;
    const scene = $('scene');
    const cart = scene.querySelector('.scene-layer.is-in [id$="-cart"]');
    const a = (cart || scene).getBoundingClientRect();
    const b = flightTarget();
    const x0 = a.left + a.width * (cart ? 0.5 : 0.7);
    const y0 = a.top + a.height * (cart ? 0.3 : 0.6);
    const x1 = b.left + 24 + Math.random() * Math.max(0, b.width - 72);
    const y1 = Math.min(Math.max(b.top + b.height * 0.4, 24), window.innerHeight - 48);
    const el = document.createElement('div');
    el.className = `flight spine-${SPINES[flightN++ % SPINES.length]}`;
    $('flights').append(el);
    const arc = Math.min(y0, y1) - 80;
    el.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(-10deg) scale(0.6)`, opacity: 0 },
      { transform: `translate(${x0 + (x1 - x0) * 0.15}px, ${y0 - 40}px) rotate(-4deg) scale(0.8)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${(x0 + x1) / 2}px, ${arc}px) rotate(12deg) scale(0.9)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) rotate(0deg) scale(0.85)`, opacity: 1, offset: 0.88 },
      { transform: `translate(${x1}px, ${y1 + 6}px) rotate(0deg) scale(0.85)`, opacity: 0 },
    ], { duration: 1600, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished.then(() => el.remove(), () => el.remove());
  }

  // ---------------------------------------------------------------- requests
  async function loadQueue() {
    try {
      const { requests } = await getJSON('/api/requests');
      const list = $('queue');
      list.textContent = '';
      (requests || []).slice(-5).forEach((r) => {
        const li = document.createElement('li');
        li.textContent = r.topic;
        list.append(li);
      });
      $('queue-wrap').hidden = !list.children.length;
    } catch (e) { /* the list is a nicety; the form still works */ }
  }

  function fieldError(input, errEl, text) {
    errEl.textContent = text || '';
    errEl.hidden = !text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  async function submitRequest(e) {
    e.preventDefault();
    const topic = $('req-topic');
    const framing = $('req-framing');
    const status = $('req-status');
    status.textContent = '';
    if (!topic.value.trim()) { fieldError(topic, $('req-topic-error'), ui('topicNeeded')); topic.focus(); return; }
    fieldError(topic, $('req-topic-error'), '');
    const btn = $('req-submit');
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-disabled', 'true');
    try {
      const r = await postJSON('/api/request', { topic: topic.value.trim(), framing: framing.value.trim() });
      say(status, pick(copy.requests && copy.requests.queued, { n: r.queued }, 'queued'), { n: r.queued });
      topic.value = '';
      framing.value = '';
      loadQueue();
    } catch (err) {
      status.textContent = ui('requestFailed');
    } finally {
      btn.removeAttribute('aria-disabled');
    }
  }

  // ---------------------------------------------------------------- the Library
  const setStatus = (text) => { const s = $('search-status'); if (s.textContent !== text) s.textContent = text; };
  const plural = (n, one, many) => (n === 1 ? ui(one) : fmt(ui(many), { count: n }));

  async function loadLibrary() {
    const token = ++state.libToken;
    const shelves = $('shelves');
    shelves.setAttribute('aria-busy', 'true');
    if (!state.library) shelves.innerHTML = `<p class="shelves-note">${LouiseMd.escape(ui('loading'))}</p>`;
    try {
      const data = await getJSON(`/api/library?arrange=${encodeURIComponent(state.arrange)}&q=${encodeURIComponent(state.q)}`);
      if (token !== state.libToken) return;
      state.library = { sections: data.sections || [], books: data.books || [] };
      state.library.books.forEach((b) => { if (b.kind === 'run-summary' && b.run) state.runTitles.set(b.run, b.title); });
      $('library-examples').textContent = ui('examples');
      $('library-examples').hidden = data.examples !== true;
      renderLibrary();
    } catch (e) {
      if (token !== state.libToken) return;
      if (!state.library) shelves.innerHTML = `<p class="shelves-note is-error">${LouiseMd.escape(ui('libraryError'))}</p>`;
    } finally {
      if (token === state.libToken) shelves.setAttribute('aria-busy', 'false');
    }
  }

  const dateText = (d) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? (d || '') : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const statusText = (s) => (copy.library && copy.library.status && copy.library.status[s]) || s || '';

  function spine(b, color, maxLines) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `spine spine-${color} kind-${b.kind || 'topic'} status-${b.status || 'finished'}`;
    if (state.highlight.has(b.id)) btn.classList.add('is-match');
    btn.dataset.id = b.id;
    const size = Math.sqrt(Math.max(1, Number(b.lines) || 1) / Math.max(1, maxLines));
    btn.style.setProperty('--h', (0.62 + 0.38 * size).toFixed(3));
    btn.style.setProperty('--w', String(Math.min(8, Math.max(1, Number(b.pages) || 1))));
    let hash = 0;
    for (const ch of String(b.id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    btn.style.setProperty('--tone', ((hash % 5) * 0.04).toFixed(2));
    const kind = b.kind && b.kind !== 'topic' ? ui(`kind_${b.kind}`) : '';
    btn.setAttribute('aria-label', [b.title, kind, statusText(b.status), dateText(b.date)].filter(Boolean).join(', '));
    btn.title = b.title;
    const title = document.createElement('span');
    title.className = 'spine-title';
    title.textContent = b.title;
    btn.append(title);
    if (b.status && b.status !== 'finished') {
      const mark = document.createElement('span');
      mark.className = 'spine-mark';
      mark.setAttribute('aria-hidden', 'true');
      btn.append(mark);
    }
    btn.addEventListener('click', () => openBook(b.id, btn));
    li.append(btn);
    return li;
  }

  function renderLibrary() {
    const { sections, books } = state.library;
    const shelves = $('shelves');
    const indicators = $('indicators');
    shelves.textContent = '';
    indicators.textContent = '';
    $('library-count').textContent = plural(books.length, 'oneBook', 'books');
    let said = $('search-status').dataset.keep || (state.q ? plural(books.length, 'oneMatch', 'matches') : '');
    if (state.arrangedBy) {
      const by = state.arrangedBy; state.arrangedBy = '';
      const n = sections.filter((sec) => books.some((b) => b.section === sec.id)).length;
      said = fmt(ui(n === 1 ? 'oneShelf' : 'arranged'), { n, by }) + (state.q ? ` ${plural(books.length, 'oneMatch', 'matches')}.` : '');
    }
    setStatus(said);
    if (!books.length) {
      const p = document.createElement('p');
      p.className = 'shelves-note';
      if (state.q) say(p, pick(copy.library && copy.library.notFound, { topic: state.q }, 'notFound'), { topic: state.q });
      else p.textContent = (copy.library && copy.library.empty) || '';
      shelves.append(p);
      $('indicators-nav').hidden = true;
      return;
    }
    const maxLines = Math.max(...books.map((b) => Number(b.lines) || 1));
    sections.forEach((sec, i) => {
      const color = SPINES[i % SPINES.length];
      const mine = books.filter((b) => b.section === sec.id);
      if (!mine.length) return;
      const id = `shelf-${i}`;

      const ind = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${id}`;
      a.className = `indicator spine-${color}`;
      a.innerHTML = '<span class="indicator-dot" aria-hidden="true"></span>';
      const label = document.createElement('span');
      label.className = 'indicator-label';
      label.textContent = sec.label || sec.id;
      const count = document.createElement('span');
      count.className = 'indicator-count';
      const num = sec.count != null ? sec.count : mine.length;
      const n = document.createElement('span');
      n.setAttribute('aria-hidden', 'true');
      n.textContent = String(num);
      const unit = document.createElement('span');
      unit.className = 'vh';
      unit.textContent = plural(Number(num), 'oneBook', 'books');
      count.append(n, unit);
      a.append(label, count);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const h = $(id);
        h.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
        h.focus({ preventScroll: true });
      });
      ind.append(a);
      indicators.append(ind);

      const shelf = document.createElement('section');
      shelf.className = `shelf spine-${color}`;
      shelf.setAttribute('aria-labelledby', id);
      const plate = document.createElement('h3');
      plate.className = 'shelf-plate';
      plate.id = id;
      plate.tabIndex = -1;
      const pl = document.createElement('span');
      pl.textContent = sec.label || sec.id;
      const pc = document.createElement('span');
      pc.className = 'shelf-count';
      pc.textContent = plural(mine.length, 'oneBook', 'books');
      plate.append(pl, pc);
      const row = document.createElement('ul');
      row.className = 'shelf-row';
      row.setAttribute('role', 'list');
      mine.forEach((b) => row.append(spine(b, color, maxLines)));
      shelf.append(plate, row);
      shelves.append(shelf);
    });
    $('indicators-nav').hidden = false;
  }

  let searchTimer = null;
  function onSearchInput() {
    clearTimeout(searchTimer);
    $('q').removeAttribute('aria-invalid');
    searchTimer = setTimeout(() => {
      state.q = $('q').value.trim();
      state.highlight = new Set();
      $('search-status').dataset.keep = '';
      loadLibrary();
    }, 250);
  }

  // ---------------------------------------------------------------- Ask Louise: she fetches the book
  async function askLouise(e) {
    e.preventDefault();
    const q = $('q').value.trim();
    const status = $('search-status');
    if (!q) { status.textContent = ui('askNeeded'); $('q').setAttribute('aria-invalid', 'true'); $('q').focus(); return; }
    const hold = still() ? 500 : 4400; // the fetching scene's loop ends with her presenting the book at about 4.4 s
    const started = Date.now();
    state.holdUntil = started + hold + 400;
    if (state.stage !== 'fetching') { state.stage = 'fetching'; showScene('fetching'); clearInterval(flightTimer); }
    caption('fetching', {});
    state.stageKey = 'fetching|';
    status.textContent = '';
    let res;
    try { res = await postJSON('/api/fetch', { q }); }
    catch (err) { state.holdUntil = 0; status.textContent = ui('fetchFailed'); return; }
    await sleep(Math.max(0, hold - (Date.now() - started)));
    state.holdUntil = 0;
    const matches = Array.isArray(res.matches) ? res.matches : [];
    state.highlight = new Set(res.book ? [res.book, ...matches] : matches);
    if (res.book) {
      const line = pick(copy.library && copy.library.found, { topic: q }, 'found');
      say(status, line, { topic: q });
      status.dataset.keep = status.textContent;
      if (state.library) renderLibrary();
      openBook(res.book, $('ask'));
    } else {
      say(status, pick(copy.library && copy.library.notFound, { topic: q }, 'notFound'), { topic: q });
      status.dataset.keep = status.textContent;
      if (state.library) renderLibrary();
      const first = document.querySelector('.spine.is-match');
      if (first) first.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' });
    }
  }

  // ---------------------------------------------------------------- the open book
  const pageName = (p) => (copy.book && copy.book.pageNames && copy.book.pageNames[p.name]) || p.name || '';

  async function openBook(id, opener) {
    state.opener = opener || document.activeElement;
    state.openerId = state.opener && state.opener.dataset ? state.opener.dataset.id || '' : '';
    let book;
    try { book = await getJSON(`/api/book/${encodeURIComponent(id)}`); }
    catch (e) { $('search-status').textContent = ui('bookError'); return; }
    if (!book || !Array.isArray(book.pages) || !book.pages.length) { $('search-status').textContent = ui('bookError'); return; }
    state.book = book;
    const shelved = state.library && state.library.books.find((b) => b.id === book.id);
    const runTitle = book.kind !== 'run-summary' && state.runTitles.get(book.run);
    $('book-kind').textContent = ui(`kind_${book.kind}`) || '';
    $('book-title').textContent = book.title || book.id;
    const meta = $('book-meta');
    meta.textContent = '';
    [['date', dateText(book.date)], ['run', runTitle || book.run], ['status', statusText(book.status)],
      ['sources', shelved && shelved.sources ? String(shelved.sources) : '']].forEach(([k, v]) => {
      if (!v) return;
      const dt = document.createElement('dt');
      dt.textContent = ui(k);
      const dd = document.createElement('dd');
      dd.textContent = v;
      meta.append(dt, dd);
    });
    const toc = $('book-toc');
    toc.textContent = '';
    book.pages.forEach((p, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toc-item';
      b.textContent = pageName(p);
      b.addEventListener('click', () => turnTo(i));
      li.append(b);
      toc.append(li);
    });
    const card = book.pages.findIndex((p) => p.kind === 'card' || p.name === 'card');
    const dlg = $('book');
    if (!dlg.open) dlg.showModal();
    await showPage(card >= 0 ? card : 0, 0);
    $('leaf-body').focus({ preventScroll: true });
  }

  function turnTo(i) {
    if (!state.book || i < 0 || i >= state.book.pages.length || i === state.page) return;
    showPage(i, i > state.page ? 1 : -1);
  }

  async function showPage(i, dir) {
    const token = ++state.pageToken;
    const book = state.book;
    const p = book.pages[i];
    state.page = i;
    const leaf = $('leaf');
    const body = $('leaf-body');
    const motion = dir !== 0 && !still() && leaf.animate;
    const out = motion && dir > 0
      ? leaf.animate([{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-88deg)', opacity: 0.4 }], { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).finished
      : Promise.resolve();
    let html;
    try {
      const page = await getJSON(`/api/book/${encodeURIComponent(book.id)}/page/${encodeURIComponent(p.n)}`);
      html = LouiseMd.render(page.markdown);
    } catch (e) {
      html = `<p class="page-error">${LouiseMd.escape(ui('pageError'))}</p>`;
    }
    await out.catch(() => {});
    if (token !== state.pageToken) return;
    $('leaf-name').textContent = pageName(p);
    body.innerHTML = html;
    body.scrollTop = 0;
    const folio = $('folio');
    folio.textContent = fmt(ui('pageOf'), { n: i + 1, of: book.pages.length });
    const pn = document.createElement('span');
    pn.className = 'vh';
    pn.textContent = `, ${pageName(p)}`;
    folio.append(pn);
    $('book-prev').setAttribute('aria-disabled', String(i === 0));
    $('book-next').setAttribute('aria-disabled', String(i === book.pages.length - 1));
    $('book-toc').querySelectorAll('.toc-item').forEach((b, k) => {
      if (k === i) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (motion && dir > 0) leaf.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    if (motion && dir < 0) leaf.animate([{ transform: 'rotateY(-88deg)', opacity: 0.4 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }

  function bookKeys(e) {
    if (e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); turnTo(state.page + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); turnTo(state.page - 1); }
  }

  // ---------------------------------------------------------------- start
  function wire() {
    $('scene-pause').addEventListener('click', () => setPaused(!state.paused));
    let saved = false;
    try { saved = localStorage.getItem('louise.paused') === '1'; } catch (e) { saved = false; }
    setPaused(saved);
    $('request-form').addEventListener('submit', submitRequest);
    $('req-topic').addEventListener('input', () => { if ($('req-topic').value.trim()) fieldError($('req-topic'), $('req-topic-error'), ''); });
    document.querySelectorAll('input[name="arrange"]').forEach((r) => r.addEventListener('change', () => {
      if (!r.checked) return;
      state.arrange = r.value;
      state.arrangedBy = r.nextElementSibling.textContent;
      $('search-status').dataset.keep = '';
      loadLibrary();
    }));
    $('q').addEventListener('input', onSearchInput);
    $('search-form').addEventListener('submit', askLouise);
    const dlg = $('book');
    $('book-close').addEventListener('click', () => dlg.close());
    $('book-prev').addEventListener('click', () => turnTo(state.page - 1));
    $('book-next').addEventListener('click', () => turnTo(state.page + 1));
    dlg.addEventListener('keydown', bookKeys);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      state.book = null;
      const again = state.openerId && document.querySelector(`.spine[data-id="${CSS.escape(state.openerId)}"]`);
      const back = state.opener && document.contains(state.opener) ? state.opener : again || $('q');
      back.focus();
    });
  }

  async function start() {
    wire();
    await loadCopy();
    pollStage();
    loadLibrary();
    loadQueue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
