# ⬡ Polygon

*Many sides, one mind.* A local-first tool for polymaths — people learning several
unrelated things at once who want their scattered progress to feel like one mind.

Polygon is not a habit tracker. There are no streaks, no guilt, no checkboxes.
You log **artifacts** — the note you wrote, the code you sketched, the puzzle you
solved — and an LLM scans them for **genuine cross-domain connections**: the way
your chess endgame study and your debounce utility both discovered that refusing
to act is sometimes the winning move. Connections render as red bridges on a
living knowledge map.

## Run it

```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY (or OPENAI_API_KEY)
npm run dev            # server on :3141, app on http://localhost:5173
```

Everything lives on your machine. The database is a single SQLite file at
`data/polygon.db` — copying that file is your backup. Your API key stays in
`.env`, which is gitignored.

## Validate the core bet first

Before trusting the product premise, run the spike:

```bash
npm run spike
```

It sends three hardcoded artifacts from genuinely unrelated domains to the LLM
and prints what it finds. Judge by hand: does each explanation reference
specifics from *both* artifacts? If it reads like "both require practice,"
the system prompt in `server/llm.ts` needs tightening before anything else matters.

## How scanning works

- Each scan evaluates artifact pairs that have never been scanned before
  (new-vs-all pairing, capped at 60 pairs per scan).
- Every evaluated pair is recorded — **no pair is ever scanned twice.**
- The model is instructed that reporting zero connections is a good outcome.
  Silence beats platitudes.
- A failed scan (network, API error) records nothing, so those pairs retry next time.
- Deleting an artifact cascades away its connections and scan history.

## Stack

Vite + React + TypeScript · Express · better-sqlite3 (WAL, single file) ·
React Flow + dagre for the map · Anthropic or OpenAI-compatible LLM via your own key.
