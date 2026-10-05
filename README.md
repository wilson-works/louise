# Louise, the Research Librarian

Louise is a research agent for the WilsonWorks Workspace, with the habits of a very good librarian. Ask her a
question and she looks it up properly: she reads the sources, has five readers check the findings, and trims each
topic to one short card. Every fact comes with the source it came from.

Everything she finds goes on the shelves of her Library, which you can arrange by topic, run, month or status.
Open a book to flip through the full report, or ask Louise and she'll fetch it. New to AI? She's a good place to
start: she explains as she goes, and when she doesn't know, she says so.

## What she does

A research run has four stages, and her dashboard shows each one:

| Stage | What happens | What you see |
|---|---|---|
| Looking it up | For each question, a quick check that it is clear enough to research, then a deep read of the web with a source for every fact. | Louise at her beige computer, typing |
| The reading room | Five AI readers go over the findings and check each other's notes. | Louise reading a book |
| The red pen | Each topic is cut down to one summary card. | Louise at her desk with a red marker |
| Shelving | She writes a summary book for the run and shelves everything. | Louise filling a book cart |

She is built from four skills in the free claude_skills pack: `marathon-research`, `marathon-research-council`,
`distill` and `quick-research`. Her `agent.json` names them, so the Workspace can install any that are missing.

## Install

From your Workspace folder:

```
node agents/bin/install-agent.js https://github.com/wilson-works/louise
```

(or the path to her folder, or her `.zip`). That puts her in your Agents' wing, registers her so any chat on your
Hub can call her, and starts her dashboard after you say yes. Her dashboard is at http://127.0.0.1:7540/ on this
computer only (another port if 7540 is taken; her office door knows which).

## Use her

In a chat opened on your Hub:

- **"Louise, research my list."** She works through the questions on her list.
- **"Louise, research when to plant tomatoes outside."** It goes on her list, and she starts.
- **"Louise, what do we have on sourdough?"** She finds the book and answers from its summary card, with the paths
  to every page.

On her dashboard you can add a question to her list ("Ask me to look something up"), arrange the shelves, search
them, open a book, or press "Ask Louise" and she fetches the book for you.

From her folder, the same things work at the command line:

```
node engine/library.js find "frost dates"        the best books for a question, with their pages
node engine/library.js list --arrange month      every book, shelf by shelf (topic, run, month or status)
node engine/requests.js add "Repotting a fig"    add a question to her list
node engine/stage.js get                         what she is doing now
```

## Where her library lives

1. `louise.config.json` in her folder, if you make one (copy `louise.config.example.json`). You can list several
   research folders; new research goes to the first.
2. Otherwise `<your Hub>/50-AI/research`.
3. Until that folder exists, her shelves show the small invented library in `examples/library`, so there is
   something to browse. Her first run writes to your Hub's research folder, never into the examples.

`node engine/config.js` shows which one she is using. The layout of a library is in `SPEC.md`.

## What stays on your computer

Her dashboard listens on this computer only and answers only this computer's own addresses. It reads only inside
your library folders and writes only her stage (`state/`) and her list (`requests/`). Nothing is deleted: a
question too vague to research waits on its own shelf, and a report with a missing source is set aside and
labelled.

## For developers

- Node 20 or later, and nothing to install: Node's built-ins only, CommonJS, no build step.
- `SPEC.md` is the contract: the stage file, the API, the library layout.
- Tests are in `tests/` (`node --test tests/`).
