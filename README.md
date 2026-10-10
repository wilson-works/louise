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
| The reading room | Five AI readers go over the findings and check each other's notes. | Louise leaning in over a big open book |
| The red pen | Each topic is cut down to one summary card. | Louise at her desk with a red marker |
| Shelving | She writes a summary book for the run and shelves everything. | Louise carrying the new book to the bookcase |

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

On her dashboard you can add a question to her list ("Ask me to look something up") and press **Research my
list** to start her on it, right there. Her desk shows each step, and **Stop** ends the run (anything she finished
stays on the shelves). Changed your mind about a question? **Remove**, beside it on her list, takes it off. You can
also arrange the shelves, search them, open a book, or ask her what you already have ("Ask me what we already have",
on her desk and above the shelves): she fetches the book she thinks it's in.

If a run stops before it finishes (you pressed Stop, or the computer or the office restarted under it), her desk says
which topic it stopped at and offers **Pick up where I left off**. That runs just the topics it didn't finish, in the
same order, with the same words and request times. A topic counts as finished when its `meta.json` says `complete`,
so a finished topic is never researched twice. A half-written one is started again. One she set aside (missing
sources, or a question that needs sharpening) stays on its shelf. You don't need to write to her about it: after a
crash the request box points to that button, and new questions wait on her list for the run after.

A book she fetches for a question asks **"Was this the book you needed?"** Say no, and she tries the next shelf; when
she runs out, she offers to put the question on her list. She remembers each answer, so a book that was right for a
question comes first the next time someone asks something like it, and one that wasn't comes last. The answers stay in
`state/feedback.jsonl` in her folder, on this computer only (the last 2,000); `engine/feedback.js` explains the rule.

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

## Starting her from her dashboard

"Research my list" runs Claude Code on this computer, with no one at the keyboard, in her folder, told
"Louise, research my list." It needs Claude Code installed. She looks for it in this order: `"claude": "<path>"` in
`louise.config.json` (it always wins); your PATH; `~/.local/bin`; on Windows, npm's own folder (`%APPDATA%\npm`), for
an office started without npm on its PATH; and last the newest Claude Code extension for VS Code
(`~/.vscode/extensions/anthropic.claude-code-<version>-<platform>/resources/native-binary`). On Windows the `claude.cmd`
that npm installs is read for the program it starts; nothing is run through `cmd.exe` or a shell. Her status
(`/api/research`, `claudeFrom`) says where she found it. Nothing you type on the page reaches that command. She runs
one research run at a time, and Stop ends only the run she started.

A run started this way can do only what her runbook needs, and asks nobody:

| Flag | Why |
|---|---|
| `-p "Louise, research my list."` | one session that ends when the runbook ends |
| `--setting-sources project,local` | your own `~/.claude/settings.json` is not read, so your personal allow rules and hooks never widen what the run may do |
| `--append-system-prompt` (fixed words) | tells the session the dashboard started it, so it never asks or waits (CLAUDE.md, "A run started from her dashboard") |
| `--permission-mode acceptEdits` and `--add-dir <your library>` | it may write files only in her folder and in your library |
| `--permission-prompts none` | anything else is refused at once, never left waiting for a person |
| `--allowedTools WebSearch WebFetch Agent Skill` | the research itself, the skills' helpers, and the skills |
| `--allowedTools "Bash(node engine/<script>.js *)"` | her own shipped scripts only: config, requests, stage, library, fetch, and `run-state.js` and `check-citations.js`, which do the research skill's state updates and source check |
| `--disallowedTools AskUserQuestion CronCreate` | no questions, and no loop that outlives the session |
| `--disallowedTools "Edit(engine/**)" ...` | her code and settings can never be written: `engine/`, `dashboard/`, `CLAUDE.md`, `subagent.md`, `agent.json`, `package.json`, `.claude/`, `.git/`, `.gitignore`, `louise.config.json`, `state/run-tmp/` |

So a run can write her list, her `state/` data and your library, and it can execute only scripts that shipped with
her. It never gets `--dangerously-skip-permissions`, and it never runs a script it wrote. A page it reads on the web
can still steer what it writes in your library, as with any research you do with AI: check the sources.

**Your own Claude Code settings do not reach a dashboard run.** The run starts with
`--setting-sources project,local`, so the allow rules and hooks in your `~/.claude/settings.json` are left out: a command
you have allowed for yourself (for example `npm run` or `python -c`) is still refused in her run. Leaving your settings
out also leaves out the skills in your `~/.claude/skills`, so just before each run she copies the skills her `agent.json`
needs (marathon-research, marathon-research-council, distill, quick-research) into her own folder's `.claude/skills/`,
from your Hub's `.claude/skills` or else `~/.claude/skills`. They load there as her project skills. The copy is
git-ignored, refreshed when the original changes, never a link, and a run cannot write to it. If one of them is
installed nowhere, she says so and doesn't start. Settings you keep in that file (an `env` block or an `apiKeyHelper`)
don't reach the run either: sign in to Claude Code the usual way and the run uses that sign-in.

The library folder is made when the run starts, if it isn't there yet. The run's output goes to
`state/research.log`; its pid, with a heartbeat, to `state/research-run.json`. When a run stops before it finishes,
`state/research-left.json` keeps which topics it left, and "Pick up where I left off" writes them to
`requests/resume.md`, which the next run takes before her list.

## What stays on your computer

Her dashboard listens on this computer only and answers only this computer's own addresses. It reads only inside
your library folders and writes only `state/` (her stage, her research run's log and pid, and what she remembers from
your answers) and her list (`requests/`). Nothing is deleted: a
question too vague to research waits on its own shelf, and a report with a missing source is set aside and
labelled.

## For developers

- Node 20 or later, and nothing to install: Node's built-ins only, CommonJS, no build step.
- `SPEC.md` is the contract: the stage file, the API, the library layout.
- Tests are in `tests/` (run `node --test` in this folder).
