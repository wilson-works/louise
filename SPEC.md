# Louise the Librarian: the build spec

Louise is a WilsonWorks specialist agent: a research librarian who runs the whole marathon-research pipeline (scope
check, deep research, council, distill, and the final summary), keeps everything she finds in a library you can browse
like shelves of books, and fetches any of it when you ask. She installs into any WilsonWorks Workspace with
`install-agent` and gets an office in its Agents' wing. This file is the contract the three build lanes share.

## The owner's brief (2026-10-05, verbatim)

> "I do like a research agent with the entire marathon research stages built in, Louise the Librarian, and elderly lady
> with big square glasses on a chain, working on what looks like a circa 2000s PC box monitor (beige colored) and when
> working in her dashboard, louise stares at the screen (Like Monitor is left side profile, screen facing louise, lights
> emitting like pages refreshing, and louise, inches from the screen, side profile, while he hands type away on the
> keyboard on the desk. Then during the council stage, she is reading a book, and during the distill phase, she is at
> her desk with a red marker writing on papers, and during the final summary build she is filling a cart of books that
> go into a research library section of her dashboard that allows the user to store by filter of choice all the
> research topics, runs, and finished research by looking at a library shelf with indicators of the different sections,
> and then open up a book to pull the research reports to flip through. Or the user can just ask louise and she will go
> fetch it from the library. (We have all the components for this agent already, so just need to send a design team in
> to build her branding, design, style, character, voice, and build her office and dashboard, and then offer Louise as
> the first install option and add her to my own office as well."
>
> "Louise is more specific because I think its a fun take on the researcher and opens friendly to new users with AI."

## The components she is built from (the free claude_skills pack, already written)

| Stage | Skill | What it leaves on disk |
|---|---|---|
| Research | `marathon-research` (a Sonnet scope check, then an Opus deep researcher per topic) | `<root>/<YYYY-MM-DD>-<slug>/` with `00-brief.md`, `01-overview.md`, `02-deep-dive.md`, `sources.md`, `meta.json`; `<root>/failed/`, `<root>/flagged/`, `<root>/INDEX.md`; a state file `marathon-research-state.json` (queue, waves, totals) |
| Council | `marathon-research-council` | `council-summary-<timestamp>.md` (+ transcript, HTML report) in the council folder |
| Distill | `distill` | one card of 200 lines or fewer per topic, `summaries/<slug>.md`, and `_index.md` |
| Final summary | Louise's own step | the run's summary book, and the library index rebuilt |
| Quick answers | `quick-research` | an inline answer with sources |

`agent.json` names these under `requires.skills`; `install-agent` installs any that are missing from the Workspace's
pinned pack.

## Repository layout and who owns what

| Path | What | Lane |
|---|---|---|
| `agent.json` | the Workspace agent contract (key `louise`, port 7540 by default) | E |
| `art.svg`, `mark.svg` | her office-door figure and her mark. Plain files at the top: the contract requires it | D |
| `CLAUDE.md` | who she is, how she talks (from `brand/character.md`), and her runbook | E (character from V) |
| `subagent.md` | the Claude Code subagent ("ask Louise ..."), registered at `<Hub>/.claude/agents/louise.md` | E |
| `brand/VOICE.md`, `brand/character.md`, `brand/copy.json` | her voice, her character sheet, every line she says on the dashboard and at her door | V |
| `brand/tokens.css` | palette and type | D |
| `art/` | the scenes and their parts (SVG) | D |
| `dashboard/public/` | the dashboard page (`index.html`, `app.js`, `app.css`), no build step | D |
| `dashboard/server.js` | the dashboard server: static files and the JSON API below. Node built-ins only | E |
| `engine/` | `config.js`, `library.js` (the index), `stage.js` (the stage file and its CLI), `fetch.js`, `requests.js` | E |
| `examples/library/` | a small invented library (5 or 6 topics, one run, one council, cards) for development, demos and the videos | E |
| `louise.config.example.json` | the library roots, the port | E |
| `tests/` | `node:test`, written for the gate, not run by builders | E (D may add UI tests) |
| `README.md` | what she is, install, use | E (copy from V) |

`state/`, `requests/` and `louise.config.json` are machine-local and git-ignored.

## The stage: one file drives her animation

`state/louise.json`:

```json
{ "stage": "idle | researching | council | distill | shelving | fetching", "topic": "Frost dates for raised beds",
  "run": "2026-10-05-garden", "step": { "n": 2, "of": 5 }, "since": "2026-10-05T19:40:00Z", "note": "Reading source 14 of 23" }
```

- Her runbook calls `node engine/stage.js set <stage> [--topic ..] [--run ..] [--step n/of] [--note ..]` at every step,
  and `node engine/stage.js set idle` at the end.
- When the file is stale (no change for 2 hours) and no marathon-research state file says `running`, the stage reads
  `idle`. When the marathon-research state file says a wave is in progress and Louise's file says nothing newer, the
  stage reads `researching`.
- `fetching` lasts about six seconds after a fetch, then the stage falls back to what it was.

## The scenes (lane D draws them)

Louise: an elderly lady with big square glasses on a chain. Her computer: a beige, circa-2000 PC, a box CRT monitor and
a beige tower, with a keyboard on a wooden desk.

| Stage | Scene |
|---|---|
| `researching` | The monitor in left side profile, its screen facing Louise; light from the screen flickers like pages refreshing. Louise in side profile, inches from the screen, her hands typing away at the keyboard. |
| `council` | Louise reading a book: in the reading room she leans in over a big open book on her desk, a second open book and the readers' stack beside her. |
| `distill` | Louise at her desk with a red marker, writing on papers. |
| `shelving` | Louise gets up with the new book, walks to the bookcase and slides it into its place on the shelf (the owner, 2026-10-05: no cart); each time, a book flies from there into the Library section of the dashboard. |
| `fetching` | Louise going to the shelf and coming back with the book you asked for. |
| `idle` | Louise at rest at her desk, reading a book, sitting back, her tea set aside on the desk (the owner, 2026-10-05). |
| (presenting) | Not a stage: the page shows it at rest while a finished book waits for you (see below). Louise stands by her desk holding the new book out, eager. |

Motion is CSS on the SVG parts, gentle, and stops for people who ask for reduced motion. The office-door figure
(`art.svg`) is Louise standing, glasses on the chain, friendly.

## The dashboard

One page, three parts:

1. **Her desk**: the scene for the current stage, a caption in her voice (from `brand/copy.json`), her screen strip,
   and a "Request research" form (a topic and a sentence of framing) that adds to her queue. The screen strip reads
   READY only at idle. In every other stage it is live: the topic, or else her note (so a run that is only getting
   ready reads `> Getting ready`), the step with its dots, and the minutes the step has run.
2. **The Library**: shelves of books. Each research topic is a book; council proceedings and run summaries are books
   too. A shelf indicator shows each section and its count. "Arrange the shelves by" Topic, Run, Month or Status (the
   filter of choice), plus a search box. Book spines show the title, colour by section, height by size.
3. **The open book**: click a book and it opens; flip through its pages (the brief, the overview, the deep dive, the
   sources, the summary card, its council notes). Markdown rendered as plain, safe HTML (no raw HTML from the files).

A new book waits for you (the owner, 2026-10-05: "when she finishes a report we haven't seen yet she should be standing
eagerly waiting to show us before putting it up after we close it for the first time"). `state/seen.json` (git-ignored)
keeps the books you have opened. The first time it is read, every book already on the shelves counts as seen; the
examples never count. At rest (stage `idle`), while a finished book is not on that list, the page shows the
`presenting` scene with "Show me the book". Closing that book the first time posts `/api/seen`; she then walks it to
the shelves (the `shelving` scene, once) and goes back to reading. The run's own stages do not change.

On a phone (under 600 px) the shelves show each book lying flat, one to a row, its title across in two lines with its
date and status; the open book scrolls as one page, its page names sit in one row that scrolls sideways, wide tables and
code scroll inside their own box, and Previous and Next stay below the page.

"Ask Louise to fetch it": the search box's "Ask Louise" button posts to `/api/fetch`; the stage goes to `fetching`, she
brings the book, and it opens.

## The API (lane E serves it, lane D uses it)

| Request | Answer |
|---|---|
| `GET /health` | `{"ok":true}` (no token, ever: the office probes it) |
| `GET /api/stage` | the stage object above |
| `GET /api/library?arrange=topic\|run\|month\|status&q=` | `{ "sections": [{ "id", "label", "count" }], "books": [{ "id", "title", "section", "kind": "topic\|council\|run-summary", "status": "finished\|in-progress\|failed\|flagged", "date", "run", "sources", "lines", "pages": n }], "examples": true\|false, "unseen": [{ "id", "title" }] }` (`examples`: the shelves hold only the invented examples; `unseen`: finished books you have not opened yet, newest first, whatever the search) |
| `GET /api/book/<id>` | `{ "id", "title", "kind", "status", "date", "run", "pages": [{ "n", "name", "kind", "file" }] }` (page `kind`: `brief`, `report`, `sources`, `card`, `council`, `validation`, `transcript`, `run-summary`, `note`; `name` comes from `brand/copy.json` `book.pageNames`) |
| `GET /api/book/<id>/page/<n>` | `{ "n", "name", "kind", "markdown" }`: only a file inside a configured library root, at most 512 KB |
| `POST /api/fetch` `{ "q" }` | `{ "book": "<id>" or null, "matches": [ids] }`, and the stage goes to `fetching` |
| `POST /api/request` `{ "topic", "framing" }` | appended to `requests/queue.md` in marathon-research's queue format; `{ "queued": n }` |
| `GET /api/requests` | `{ "requests": [{ "topic", "framing", "at" }] }` |
| `GET /api/research` | `{ "running", "since", "waiting", "claude" }`: is a run of her list going, how many questions wait, is Claude Code here |
| `POST /api/research` `{}` | starts one run of her list (`engine/research.js`: Claude Code headless in her folder, fixed arguments); `202 { "running": true }`, or `409 { "error", "reason": "empty\|running\|no-claude\|no-library\|no-skill" }; before it starts, the skills her `agent.json` requires are copied into her `.claude/skills/` (`engine/skills.js`), and the run leaves the user's own settings out (`--setting-sources project,local`)` |
| `POST /api/research/stop` `{}` | stops the run she recorded, and only it; her stage goes to `idle`; `409` (`not-running`) when there is none |
| `POST /api/feedback` `{ "q", "book", "helpful" }` | remembers whether the book she brought for `q` was the one you needed, in `state/feedback.jsonl`; `{ "remembered": n }` |
| `POST /api/seen` `{ "book" }` | you have opened this book (sent when it is closed the first time), kept in `state/seen.json`; `{ "seen": n, "unseen": [{ "id", "title" }] }`; `404` when the book is not on the shelves |

The server binds 127.0.0.1 only, answers only Host `127.0.0.1`, `localhost` or the host in its own `door.phone`, reads
only inside the configured library roots, and writes only `state/` and `requests/`. The one program it starts is a
research run (`POST /api/research`), with arguments fixed in `engine/research.js`.

## The library roots

`louise.config.json` (machine-local, git-ignored; the example ships):

```json
{ "port": 7540, "library": { "roots": [ { "label": "My research", "path": "<Hub>/50-AI/research" } ] } }
```

With no config, the root is `<Hub>/50-AI/research` (found through the Hub's `.hub/hub.json`, walking up from her own
folder), else `examples/library/` so a fresh install has something on the shelves. Her runbook writes new research to
the first root.

## The library on disk

Each root is read one level deep where the layout says so, never further, and links are never followed:

| Path in a root | What it is | Becomes |
|---|---|---|
| `<YYYY-MM-DD>-<slug>/` | a topic (marathon-research): `00-brief.md`, `NN-*.md`, `sources.md`, `meta.json` | a `topic` book; `finished` when `meta.json` says `complete`, else `in-progress` |
| `marathons/<YYYY-MM-DD>-<slug>/` | the same, in a research folder laid out the way distill expects | the same |
| `failed/<YYYY-MM-DD>-<slug>.md` (or a folder) | a topic that failed its scope check | a `topic` book, `failed` |
| `flagged/<YYYY-MM-DD>-<slug>/` | a topic that failed its citation check, with `_validation-report.md` | a `topic` book, `flagged` |
| `summaries/<card>.md` | distill's summary card; `_index.md` (at the root) links each card to its topic | a page of its topic; a card with no topic on the shelves is a `topic` book of its own |
| `council/council-summary-<timestamp>.md` | a council's proceedings (`council-transcript-<timestamp>.md` is its second page) | a `council` book, and a "Reading-room notes" page on every topic it names |
| `runs/<run>.md` | Louise's run summary book, with front matter `run`, `title`, `date`, `topics: [slugs]`, `council` | a `run-summary` book; its `topics` give each topic its `run` |
| `marathon-research-state.json` | the run in progress | each wave's topic gets that run; the stage rules read it |

A book's id is `<root number>-<t|f|x|s|c|r>-<folder or file name>`. An id is only ever looked up in the index, never
turned into a path. The index is cached for 5 seconds, so a new file is on the shelves within seconds.

## Asking Louise in a session

`subagent.md` makes her callable from any chat on the Hub: "Louise, research <topic>" runs the runbook; "Louise, what do
we have on <topic>?" runs `node engine/library.js find "<topic>"` and answers from the summary card, with the book's
pages as paths.

## The rules every lane keeps

- Public-ready: no real person's name, path, hostname, business, client or private agent anywhere in the repo. The
  example library is invented (a person called Alex, topics like frost dates and sourdough starters).
- Node built-ins only at run time. No build step for the dashboard.
- No test suites run by builders (the gate runs them). Prove with a drill: start the server on your lane's port, fetch
  the API, look at the page.
- Plain English in everything a person reads. Louise's own lines are in her voice (`brand/VOICE.md`).
