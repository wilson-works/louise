// crt.js: what the terminal strip under Louise's desk shows (her screen). No page access, no network: it only turns
// her stage into lines, so it works in the browser (window.LouiseCrt) and in Node (module.exports) for the tests.
//
// Contract: lines(s, names, now) -> { ready, head, step, note, minutes }
//   s      the stage from GET /api/stage: { stage, topic, step: { n, of }, note, since }
//   names  copy.json stageNames (her label for each stage); now: the time in ms (Date.now() in the page)
// - At idle, or with no stage, she is at rest: { ready: true } and the strip says READY.
// - Any other stage means a run is at work, so the strip is live even before a topic is known. head is the topic,
//   else her note, else her name for the stage, else the stage itself. note is the note when it is not already the
//   head. step is { n, of } when the step is known. minutes is the whole minutes since the stage began (from since),
//   or null when since is missing, unreadable or in the future.
(function (root) {
  'use strict';

  const text = (v) => (v == null ? '' : String(v).trim());

  function lines(s, names, now) {
    const st = s || {};
    const stage = text(st.stage) || 'idle';
    if (stage === 'idle') return { ready: true, head: '', step: null, note: '', minutes: null };
    const topic = text(st.topic);
    const note = text(st.note);
    const label = text(names && names[stage]);
    const head = topic || note || label || stage;
    const n = st.step ? Number(st.step.n) : NaN;
    const of = st.step ? Number(st.step.of) : NaN;
    const step = Number.isInteger(n) && Number.isInteger(of) && n > 0 && of > 0 && n <= of ? { n, of } : null;
    const began = Date.parse(st.since);
    const at = Number.isFinite(now) ? now : Date.now();
    const minutes = Number.isFinite(began) && at >= began ? Math.floor((at - began) / 60000) : null;
    return { ready: false, head, step, note: note && note !== head ? note : '', minutes };
  }

  const api = { lines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LouiseCrt = api;
})(typeof window !== 'undefined' ? window : this);
