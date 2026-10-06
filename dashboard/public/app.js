// app.js: Louise's dashboard (index.html). Plain browser JavaScript, no framework, no build step.
//
// Contract:
// - Copy: every line Louise says comes from /brand/copy.json (keys starting "_" are notes and are skipped). Lines with
//   {topic} or {n} are used only when the page has that value. A few plain labels that are not her voice live in UI
//   below; a "ui" block in copy.json overrides any of them by the same key.
// - Her desk: polls GET /api/stage every 2 s. When the stage changes, the scene from /art/<stage>.svg crossfades in
//   (inline, so the pause button can stop its motion), and a new caption is picked. The strip under the scene is her
//   screen (crt.js makes its lines): READY at rest; in any other stage, what she is on (the topic, else her note), the
//   step and how many minutes so far. While she is shelving, each time the new book she carries reaches its gap on the
//   scene's bookcase, one book flies from there to the Library. The request form posts /api/request; her list comes
//   from /api/requests.
// - A new book waits for you: /api/library's unseen lists finished books not opened yet. At rest (stage idle) while one
//   waits, the presenting scene shows her holding it out, and "Show me the book" opens it. Closing a waiting book the
//   first time posts /api/seen; when she was holding it out, the shelving scene plays once, then she goes back to
//   reading. The run's stages always come first.
// - On a phone the shelves lay each book flat in a row (app.css), and in the open book wide tables and code get their
//   own sideways-scrolling box, the page names one sideways row, and a turned page starts at its own top.
// - The Library: GET /api/library?arrange=&q= draws one shelf per section with an indicator and its count. Typing in
//   the search box narrows the shelves; "Ask Louise" posts /api/fetch, plays the fetching scene, then opens the book.
//   Her desk has the same "Ask Louise" box ("Ask me what we already have"), above the fold.
// - A book opened by a question asks "Was this the book you needed?". Yes or No posts /api/feedback { q, book,
//   helpful }; on No she opens the next of that fetch's matches and asks again; when none are left she offers to add
//   the question to her list (/api/request).
// - Research my list: GET /api/research every 4 s says whether a run is going, how many questions wait and whether
//   Claude Code is here. "Research my list" posts /api/research; "Stop" (shown while a run is going) posts
//   /api/research/stop. The start button stays focusable when it cannot be used (aria-disabled) and says why beside
//   it; starting and stopping are announced politely.
// - The open book: a modal dialog. It opens on the Summary card page when the book has one (card first), flips with
//   the buttons, the contents list or the arrow keys, and renders each page with md.js (escaped, then formatted).
// - Reduced motion (or the pause button) stops the scene motion, the flights and the page turns.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STAGES = ['idle', 'researching', 'council', 'distill', 'shelving', 'fetching'];
  const SPINES = ['oxblood', 'green', 'navy', 'mustard', 'plum', 'teal', 'tan', 'slate', 'brown', 'olive'];
  const POLL_MS = 2000;
  const SHELVE_MS = 7300; // one loop of the shelving scene (7.2 s), then she goes back to reading
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Plain labels that are not Louise's own lines.
  const UI = {
    pause: 'Pause the scene',
    play: 'Play the scene',
    step: 'Step {n} of {of}',
    minutes: '{m} min so far',
    hours: '{h} h {m} min so far',
    ready: 'READY',
    offline: "Her desk can't be reached right now. The page keeps trying.",
    books: '{count} books',
    oneBook: '1 book',
    matches: '{count} books match',
    researchCheck: 'Checking whether I can start…',
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
    tableBox: 'Table, scrolls sideways',
    codeBox: 'Code, scrolls sideways',
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
    book: null, page: 0, pageToken: 0, opener: null, last: {}, asked: null, research: null,
    unseen: [], seenNow: new Set(), presentId: null,
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
  // A POST whose refusal (409 with { error, reason }) is an answer, not a failure.
  async function postAnswer(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    let data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    if (!r.ok && !(r.status === 409 && data.reason)) throw new Error(`${r.status}`);
    return Object.assign({ ok: r.ok }, data);
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

  // Her screen: live in every stage but idle, so a run never reads as READY (crt.js has the rules).
  function screen(s) {
    const crt = $('crt');
    crt.hidden = false;
    const v = LouiseCrt.lines(s, copy.stageNames, Date.now());
    const ct = $('crt-topic');
    ct.textContent = '';
    if (!v.ready) {
      const prompt = document.createElement('span');
      prompt.setAttribute('aria-hidden', 'true');
      prompt.textContent = '> ';
      ct.append(prompt, v.head);
    } else ct.textContent = ui('ready');
    const m = v.minutes;
    const since = m >= 60 ? fmt(ui('hours'), { h: Math.floor(m / 60), m: m % 60 }) : m >= 1 ? fmt(ui('minutes'), { m }) : '';
    const step = v.step ? fmt(ui('step'), { n: v.step.n, of: v.step.of }) : '';
    $('crt-step').textContent = [step, since].filter(Boolean).join(' · ');
    const dots = $('crt-dots');
    dots.textContent = '';
    if (v.step && v.step.of <= 12) {
      for (let i = 1; i <= v.step.of; i++) {
        const li = document.createElement('li');
        li.className = i < v.step.n ? 'is-done' : i === v.step.n ? 'is-now' : '';
        dots.append(li);
      }
    }
    $('crt-note').textContent = v.note;
  }

  // At rest, a finished book the person has not opened yet makes her wait to show it (the presenting scene); the run's
  // own stages always come first. The scene shown can be presenting, which is never a stage of hers.
  function applyStage(s) {
    const stage = STAGES.includes(s.stage) ? s.stage : 'idle';
    state.stageData = s;
    screen({ ...s, stage });
    if (Date.now() < state.holdUntil) return; // a fetch, or her walk to the shelves, is playing
    const waiting = stage === 'idle' ? state.unseen[0] || null : null;
    const shown = waiting ? 'presenting' : stage;
    const key = waiting ? `presenting|${waiting.id}` : stage === 'fetching' || stage === 'idle' ? `${stage}|` : `${stage}|${s.topic || ''}`;
    if (shown !== state.stage) {
      const was = state.stage;
      state.stage = shown;
      showScene(shown);
      onStageChange(shown, was);
    }
    if (key !== state.stageKey) {
      state.stageKey = key;
      caption(shown, { topic: waiting ? waiting.title : s.topic || null });
    }
    showPresent(waiting);
  }

  function showPresent(book) {
    state.presentId = book ? book.id : null;
    $('present').hidden = !book;
  }

  // The person closed a book for the first time: it is seen. When she was holding it out, she walks it to the shelves
  // (the shelving scene, once), then goes back to reading or to the next new book.
  function firstClose(id) {
    const book = state.unseen.find((u) => u.id === id);
    state.seenNow.add(id); // a shelf read already on its way must not bring it back
    state.unseen = state.unseen.filter((u) => u.id !== id);
    if (state.stage === 'presenting') {
      const hold = still() ? 1500 : SHELVE_MS;
      state.holdUntil = Date.now() + hold;
      showPresent(null);
      const was = state.stage;
      state.stage = 'shelving';
      showScene('shelving');
      onStageChange('shelving', was);
      state.stageKey = 'shelving|seen';
      caption('shelving', { topic: book ? book.title : null });
      setTimeout(pollStageNow, hold + 50);
    }
    postJSON('/api/seen', { book: id })
      .then((r) => { if (Array.isArray(r.unseen)) state.unseen = r.unseen.filter((u) => u && u.id && !state.seenNow.has(u.id)); })
      .catch(() => { /* not kept this time: the book waits again on the next visit */ });
  }

  let stageTimer = null;
  function pollStageNow() { clearTimeout(stageTimer); pollStage(); }
  async function pollStage() {
    clearTimeout(stageTimer);
    try {
      applyStage(await getJSON('/api/stage'));
      state.offline = 0;
      $('desk-offline').textContent = '';
    } catch (e) {
      state.offline += 1;
      if (state.offline >= 2) $('desk-offline').textContent = ui('offline');
      if (!state.stage) applyStage({ stage: 'idle' });
    } finally {
      stageTimer = setTimeout(pollStage, POLL_MS);
    }
  }

  // ---------------------------------------------------------------- shelving: the book she shelves goes to the Library
  // The shelving scene marks the new book she carries (an id ending "-newbook") with data-loop-ms (the scene's loop) and
  // data-placed-ms (when in that loop the book is in its gap on the bookcase). Each loop, at that moment, one book flies
  // from there down to the Library. One book a loop, no more: calm.
  let flightTimer = null;
  let flightN = 0;

  function onStageChange(stage, was) {
    clearTimeout(flightTimer);
    flightTimer = null;
    if (stage === 'shelving') flightTimer = setTimeout(nextFlight, 400); // the scene is still crossfading in
    if (was !== null) { loadLibrary(); loadQueue(); }
    // A run that just ended may have shelved its last book a moment ago; the shelves are read again after their cache.
    if (stage === 'idle' && was !== null && was !== 'presenting') setTimeout(loadLibrary, 6000);
  }

  const newBook = () => $('scene').querySelector('.scene-layer.is-in [id$="-newbook"]');

  // Ms until the new book is next in its gap, read from the scene's own running animation; null when it cannot be read.
  function untilPlaced() {
    const book = newBook();
    const loop = book ? Number(book.dataset.loopMs) : NaN;
    const placed = book ? Number(book.dataset.placedMs) : NaN;
    const svg = book && book.ownerSVGElement;
    if (!(loop > 0) || !(placed >= 0) || !svg || !svg.getAnimations) return null;
    const anim = svg.getAnimations({ subtree: true }).find((a) => a.effect && Math.abs(Number(a.effect.getTiming().duration) - loop) < 1);
    if (!anim || anim.currentTime == null) return null;
    const t = Number(anim.currentTime) % loop;
    return (((placed - t) % loop) + loop) % loop;
  }

  function nextFlight() {
    clearTimeout(flightTimer);
    const wait = still() || document.hidden ? null : untilPlaced();
    if (wait == null) { flightTimer = setTimeout(nextFlight, 1000); return; } // still, hidden or not drawn yet: look again soon
    flightTimer = setTimeout(() => { flyBook(); flightTimer = setTimeout(nextFlight, 500); }, wait);
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
    const book = newBook();
    if (still() || document.hidden || !book) return;
    const a = book.getBoundingClientRect();
    const s = $('scene').getBoundingClientRect();
    const b = flightTarget();
    const x0 = a.left + a.width * 0.5;
    const y0 = a.top + a.height * 0.5;
    const x1 = b.left + 24 + Math.random() * Math.max(0, b.width - 72);
    const y1 = Math.min(Math.max(b.top + b.height * 0.4, 24), window.innerHeight - 48);
    const el = document.createElement('div');
    el.className = `flight spine-${SPINES[flightN++ % SPINES.length]}`;
    $('flights').append(el);
    const arc = Math.min(y0, y1) - Math.min(80, s.height * 0.14); // a small toss on a phone, not a lob across the room
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
    loadResearch();
  }

  // ---------------------------------------------------------------- Research my list
  const reasonLine = (reason, fallback) => (copy.research && copy.research.reasons && copy.research.reasons[reason]) || fallback || '';
  let researchTimer = null;

  function renderResearch(st) {
    state.research = st;
    const startBtn = $('run-start');
    const stopBtn = $('run-stop');
    let note = '';
    if (!st) note = ui('researchCheck');
    else if (st.running) note = reasonLine('running');
    else if (!st.claude) note = reasonLine('no-claude');
    else if (!st.waiting) note = reasonLine('empty');
    if (note) startBtn.setAttribute('aria-disabled', 'true'); else startBtn.removeAttribute('aria-disabled');
    const n = $('run-note');
    if (n.textContent !== note) n.textContent = note;
    const showStop = Boolean(st && st.running);
    if (stopBtn.hidden === showStop) {
      // The Stop button leaves while it has focus: focus goes back to the start button, never to the top of the page.
      if (!showStop && document.activeElement === stopBtn) startBtn.focus();
      stopBtn.hidden = !showStop;
    }
  }

  async function loadResearch() {
    clearTimeout(researchTimer);
    try { renderResearch(await getJSON('/api/research')); } catch (e) { /* keeps the last answer; her desk says when it is offline */ }
    researchTimer = setTimeout(loadResearch, 4000);
  }

  function announceRun(text) {
    const live = $('run-live');
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60); // cleared first, so the same words are read again
  }

  async function startResearch() {
    const btn = $('run-start');
    if (btn.getAttribute('aria-disabled') === 'true') { announceRun($('run-note').textContent); return; }
    btn.setAttribute('aria-disabled', 'true');
    try {
      const r = await postAnswer('/api/research', {});
      announceRun(r.ok ? pick(copy.research && copy.research.started, {}, 'started') : reasonLine(r.reason, r.error));
    } catch (e) {
      announceRun(reasonLine('not-started', (copy.research && copy.research.failed) || ''));
    }
    await loadResearch();
    pollStageNow();
  }

  async function stopResearch() {
    try {
      const r = await postAnswer('/api/research/stop', {});
      announceRun(r.ok ? ((copy.research && copy.research.stopped) || '') : reasonLine(r.reason, r.error));
    } catch (e) {
      announceRun((copy.research && copy.research.failed) || '');
    }
    await loadResearch();
    pollStageNow();
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
      state.unseen = Array.isArray(data.unseen) ? data.unseen.filter((u) => u && u.id && !state.seenNow.has(u.id)) : [];
      renderLibrary();
      if (state.stageData) applyStage(state.stageData); // a new book may be waiting now
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
    // Shown only where the books lie flat in rows (narrow screens): the date, the kind and a status other than finished.
    const meta = document.createElement('span');
    meta.className = 'spine-meta';
    meta.setAttribute('aria-hidden', 'true'); // the button's name already says all of it
    meta.textContent = [dateText(b.date), kind, b.status && b.status !== 'finished' ? statusText(b.status) : ''].filter(Boolean).join(' · ');
    btn.append(title, meta);
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
  // from: the box she was asked in, { input, status, button } (the Library's search, or the one on her desk).
  async function askLouise(e, from) {
    e.preventDefault();
    const input = from.input;
    const q = input.value.trim();
    const status = from.status;
    if (!q) { status.textContent = ui('askNeeded'); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    input.removeAttribute('aria-invalid');
    const hold = still() ? 500 : 4400; // the fetching scene's loop ends with her presenting the book at about 4.4 s
    const started = Date.now();
    state.holdUntil = started + hold + 400;
    if (state.stage !== 'fetching') { state.stage = 'fetching'; showScene('fetching'); clearTimeout(flightTimer); }
    // On a phone the search sits far below her desk: bring her into view so you see her go to the shelf.
    const seen = $('scene').getBoundingClientRect();
    if (status !== $('search-status')) $('search-status').dataset.keep = '';
    if (!still() && (seen.top < 0 || seen.bottom > window.innerHeight)) $('scene').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      if (status === $('search-status')) status.dataset.keep = status.textContent;
      if (state.library) renderLibrary();
      const order = [res.book, ...matches.filter((id) => id !== res.book)];
      openBook(res.book, from.button, { q, matches: order, i: 0 });
    } else {
      say(status, pick(copy.library && copy.library.notFound, { topic: q }, 'notFound'), { topic: q });
      if (status === $('search-status')) status.dataset.keep = status.textContent;
      if (state.library) renderLibrary();
      const first = document.querySelector('.spine.is-match');
      if (first) first.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' });
    }
  }

  // ---------------------------------------------------------------- the open book
  const pageName = (p) => (copy.book && copy.book.pageNames && copy.book.pageNames[p.name]) || p.name || '';

  // asked: { q, matches, i } when she brought this book for a question, so the book asks whether it was the right one.
  async function openBook(id, opener, asked) {
    state.asked = asked || null;
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
    showVerdict();
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
    roomy(body);
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
      if (k === i) { b.setAttribute('aria-current', 'page'); intoRow(b); } else b.removeAttribute('aria-current');
    });
    // On a phone the whole book scrolls as one: a turned page starts at its own top, not halfway down the last one.
    const spread = leaf.closest('.book-spread');
    if (dir !== 0 && spread.scrollHeight > spread.clientHeight + 1) {
      spread.scrollTop += leaf.parentElement.getBoundingClientRect().top - spread.getBoundingClientRect().top;
    }
    if (motion && dir > 0) leaf.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    if (motion && dir < 0) leaf.animate([{ transform: 'rotateY(-88deg)', opacity: 0.4 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }

  // Wide tables and code scroll sideways inside their own box, never the page; each box can take keyboard focus so it
  // can be scrolled without a mouse (SC 2.1.1).
  function roomy(body) {
    body.querySelectorAll('table').forEach((t) => {
      const box = document.createElement('div');
      box.className = 'md-table';
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', ui('tableBox'));
      t.replaceWith(box);
      box.append(t);
    });
    body.querySelectorAll('pre').forEach((pre) => {
      pre.tabIndex = 0;
      pre.setAttribute('role', 'region');
      pre.setAttribute('aria-label', ui('codeBox'));
    });
  }

  // In the one-line row of page names (narrow screens), keep the current page's name in view.
  function intoRow(item) {
    const row = $('book-toc');
    if (row.scrollWidth <= row.clientWidth) return;
    const r = item.getBoundingClientRect();
    const o = row.getBoundingClientRect();
    row.scrollLeft += (r.left - o.left) - (o.width - r.width) / 2;
  }

  // ---------------------------------------------------------------- was this the book you needed?
  function showVerdict(said) {
    const v = $('verdict');
    v.hidden = !state.asked;
    $('book').classList.toggle('is-asked', Boolean(state.asked));
    if (!state.asked) return;
    $('verdict-q').hidden = false;
    $('verdict-yes').hidden = false;
    $('verdict-no').hidden = false;
    $('verdict-add').hidden = true;
    $('verdict-said').textContent = said || '';
  }

  function verdictDone() {
    $('verdict-q').hidden = true;
    $('verdict-yes').hidden = true;
    $('verdict-no').hidden = true;
  }

  async function answer(helpful) {
    const asked = state.asked;
    const book = state.book;
    if (!asked || !book) return;
    const said = $('verdict-said');
    try {
      await postJSON('/api/feedback', { q: asked.q, book: book.id, helpful });
    } catch (e) {
      said.textContent = ui('requestFailed');
      return;
    }
    const f = copy.feedback || {};
    if (helpful) {
      verdictDone();
      said.textContent = pick(f.thanks, {}, 'thanks');
      said.focus();
      return;
    }
    const next = asked.matches[asked.i + 1];
    if (next) {
      const line = pick(f.tryAnother, {}, 'tryAnother');
      said.textContent = line;
      await openBook(next, state.opener, { q: asked.q, matches: asked.matches, i: asked.i + 1 });
      if (state.asked) showVerdict(line);
      return;
    }
    verdictDone();
    $('verdict-add').hidden = false;
    said.textContent = pick(f.outOfBooks, {}, 'outOfBooks');
    $('verdict-add').focus();
  }

  async function addAskedToList() {
    const asked = state.asked;
    if (!asked) return;
    const said = $('verdict-said');
    try {
      const r = await postJSON('/api/request', { topic: asked.q });
      say(said, pick(copy.requests && copy.requests.queued, { n: r.queued }, 'queued'), { n: r.queued });
      $('verdict-add').hidden = true;
      said.focus();
      loadQueue();
    } catch (e) {
      said.textContent = ui('requestFailed');
    }
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
    $('search-form').addEventListener('submit', (e) => askLouise(e, { input: $('q'), status: $('search-status'), button: $('ask') }));
    $('desk-ask-form').addEventListener('submit', (e) => askLouise(e, { input: $('desk-q'), status: $('desk-ask-status'), button: $('desk-ask') }));
    $('desk-q').addEventListener('input', () => $('desk-q').removeAttribute('aria-invalid'));
    $('run-start').addEventListener('click', startResearch);
    $('run-stop').addEventListener('click', stopResearch);
    $('verdict-yes').addEventListener('click', () => answer(true));
    $('verdict-no').addEventListener('click', () => answer(false));
    $('verdict-add').addEventListener('click', addAskedToList);
    const dlg = $('book');
    $('book-close').addEventListener('click', () => dlg.close());
    $('book-prev').addEventListener('click', () => turnTo(state.page - 1));
    $('book-next').addEventListener('click', () => turnTo(state.page + 1));
    dlg.addEventListener('keydown', bookKeys);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      const closed = state.book && state.book.id;
      state.book = null;
      state.asked = null;
      if (closed && state.unseen.some((u) => u.id === closed)) firstClose(closed); // may hide the button that opened it
      const again = state.openerId && document.querySelector(`.spine[data-id="${CSS.escape(state.openerId)}"]`);
      const shown = (el) => el && document.contains(el) && el.offsetParent !== null;
      const back = [state.opener, again, $('scene-pause'), $('desk-q'), $('q')].find(shown);
      if (back) back.focus();
    });
    $('present').addEventListener('click', () => { if (state.presentId) openBook(state.presentId, $('present')); });
  }

  async function start() {
    wire();
    await loadCopy();
    renderResearch(null);
    pollStage();
    loadLibrary();
    loadQueue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
