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
`data/polygon.db` — copying that file is your backup, and the ☰ menu offers
explicit **⬇ export .db / ⬆ import .db** round-trips (import replaces your
data, transactionally, with id remapping). Your API key stays in `.env`,
which is gitignored.

## Accounts & the Commons (optional)

Polygon runs in **solo mode** by default — no sign-in, all data owned locally.
To turn on Google sign-in and the community layer, create a free
[Clerk](https://dashboard.clerk.com) app, enable the Google social connection,
and add to `.env`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Restart and Polygon gates behind sign-in, scopes every pursuit to its owner,
and lights up the **Commons** (west vertex of the hexagon): a member roster
and a feed of connections discovered inside pursuits their owners chose to
make public. Pursuits are **private by default** — flip ○/◉ on the Pursuits
page. Moving from solo to signed-in? Export your .db first, sign in, import.

## The Atlas (east vertex: Discover)

The social layer's main surface is **the Atlas** — one shared knowledge map.
Everyone's public pursuits merge into a collective graph (normalized by name);
nodes pulse when an artifact landed in the last 24 hours; clicking a pursuit
reveals its polymaths and their recent work; profiles show a member's public
polygon, and you follow people from inside the map. A live feed rail runs
alongside via SSE (10s poll fallback) — **the feed unit is the artifact**:
you post by learning, there is no free-text post type.

Architecture: the whole social layer is a separable module. Core routes emit
through a no-op emitter (`server/events.ts`); the module (`server/social/`,
`src/social/` as a lazy chunk) subscribes at mount. Deleting the mount line
leaves the core app fully functional — this is tested. Feed storage is
append-only with filter-on-read (deleted or re-privatized content vanishes
from the feed automatically). Moderation floor: owner-delete, per-viewer hide
(localStorage), and a `reports` table on every piece of public content.

Want to see the Atlas alive before your friends arrive?

```bash
npm run seed:demo            # three demo polymaths with public pursuits
npm run seed:demo -- --clean # remove them
```

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
