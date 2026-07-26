# §34 (working spec) — The board: our status page as a Loam app

**Ticket:** T108. **Status:** design-stage draft — STOPS for Myk's sign-off before any build.

The live status board — what waits on Myk, what is in flight, what has not shipped — becomes a
Loam application operated by the team itself. The board is exactly Loam's shape: many writers
appending small claims, one lens rendering them, history load-bearing. Dogfooding it makes every
operational gap daily pain until fixed, and makes the model's promises (attribution, as-of,
convergence) things we *use* rather than things we demonstrate.

What this deliberately is NOT (v1 non-goals, each with its ticket): no write FORMS on the board
page (pens are T102's); no phone-direct serving (`--host` is T103's); no in-page approve buttons
(the connector story, noted in T108); not the container console (T92 — this is its seed, not its
delivery).

## The store

One long-lived governed store, **Myk's own**: his operator seed, a home he names (never an
agent-created path), served with `loam serve` under his control. Everything the board is lives in
this store as ordinary deltas — the artifact on claude.ai becomes a **generated mirror** of it,
never hand-edited again.

## The vocabulary

One schema, `BoardItem`, latest-wins per prop — a board event is one delta:

| prop | meaning |
| --- | --- |
| `kind` | `waiting` \| `lane` \| `ticket` \| `note` |
| `title` | the human line ("#262 — T64 piece 4: the receipt") |
| `seam` | the one-sentence what-actually-changes (the card discipline, at rest) |
| `url` | the PR/ticket link |
| `status` | `open` \| `building` \| `review` \| `waiting-myk` \| `shipped` \| `parked` \| `blocked` |
| `est` | minutes, for waiting-Myk items |

Entity ids are stable and legible: `board:pr-262`, `board:lane-t79`, `board:ticket-T105`. A
registered **claim template** (`boardEvent`) makes one mutation write one multi-pointer delta, so
a session reports a transition in a single authed call to the GraphQL door.

**Nothing is removed to leave the board.** `status: shipped` IS the exit; the view filters. The
board's history is the point — erasure should essentially never touch this store, which is also
what makes it the honest as-of demo.

## Writers

Attribution is the product: every entry is signed. Myk is the operator; **Fable gets one granted
author** (a seed Myk mints and hands to sessions via env), and every lane reports through Fable's
signature in v1. Per-lane authors are a widening for later — the grant machinery supports it the
day attribution-per-lane earns its keep.

## The renderer

Route `board`, read-only, consuming the props above; a **public declaration** opens it to
tokenless LAN reads. It renders the four sections by `kind`+`status` (waiting-on-Myk with seams
and est-minutes; in-flight; backlog; shipped-today). The build test of §23 is stated as a
criterion: if this page is unpleasant to build as a renderer, that is a §23 finding, not a reason
to reach for a framework.

## The mirror

`scripts/render-board-artifact.mjs` queries the store's own door and emits the claude.ai artifact
HTML — content exclusively from the store, so the artifact can never disagree with it. Fable
republishes on each event, same URL as today.

## As-of

No route parameter in v1; the door already answers it: an `asOf` query over `BoardItem` entities
is "the board as of yesterday morning," and criterion (g) makes it a rail so the demo can never
rot.

## Acceptance criteria

- (a) A `BoardItem` registered on a fresh store via `/register`, with the `boardEvent` claim
  template, accepts one-call transitions and resolves latest-wins — verified by
  `test/board/board-app.test.ts` driving a real Gateway.
- (b) A granted non-operator author (the Fable grant) can write `boardEvent` mutations through the
  authed door, and an ungranted author is refused — `test/board/board-app.test.ts`.
- (c) The `board` route renders every section from live store state, and a `boardEvent` mutation
  changes the rendered page on the next GET — `test/board/board-render.test.ts`, the
  renderers-demo pattern driven headless.
- (d) The public declaration serves the route tokenless while the GraphQL door still refuses
  tokenless writes — `test/board/board-render.test.ts`.
- (e) The mirror script's output contains exactly the store's items — every rendered title
  originates from a resolved `BoardItem`, none from the script — `test/board/board-mirror.test.ts`
  comparing generated HTML against the store's own view set, two-sided (an item added appears; a
  string not in any view does not).
- (f) `status: shipped` items leave the waiting/in-flight sections and remain queryable —
  `test/board/board-app.test.ts`.
- (g) An `asOf` query at a captured moment answers yesterday's board — the item's prior status —
  after later transitions land — `test/board/board-app.test.ts`.
- (h) The demo boot script (`demos/board/boot.mjs`) stands the whole thing up from an empty home
  in one run — schema, template, grant, renderer, public declaration — and is itself the
  documented operator path — `test/board/board-boot.test.ts` executing it against a temp home.

## Design questions — (Myk), each with a recommendation

1. **Where does the store run?** Recommendation: a `loam serve` process on your box (tmux or a
   user service), home at a path you name; sessions reach it at `127.0.0.1:<port>` with the token
   in the session environment. T103's `--host` later makes the same store the phone's board.
2. **One Fable author, or per-lane grants?** Recommendation: one, v1 — attribution-per-lane is a
   grant away whenever you want the finer grain, and the history stays honest either way.
3. **Retention: does `shipped` ever get pruned?** Recommendation: never — the board is the
   operational record, storage is trivial, and retention is what makes as-of real.
4. **Does this replace the session task list and the hand-edited artifact on day one?**
   Recommendation: artifact yes (it becomes the mirror), task list no (harness plumbing, different
   animal) — revisit after a week of operating it.
