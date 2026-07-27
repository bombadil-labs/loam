## 34. The board — our status page as a Loam app

The live status board — what waits on Myk, what is in flight, what has shipped — is a Loam
application operated by the team itself. It exists because the board is exactly Loam's shape: many
writers appending small claims, one lens rendering them, history load-bearing. Dogfooding it makes
every operational gap daily pain until fixed, and turns the model's promises — attribution, as-of,
convergence — into things we *use* rather than things we demonstrate. It proved that role on its
first day (see the Provenance footer's list of what it flushed out before its own landing merged).

What this deliberately is NOT, each refusal with its owner: no write forms on the page (pens are
T102's); no phone-direct serving (`--host` is T103's); no in-page approve buttons (the connector
story); not the container console (T92 — this is its seed, not its delivery).

### 34.1 The store

One long-lived governed store, **Myk's own**: his operator seed, a home he names (never an
agent-created path), served with `loam serve` under his control. Everything the board is lives in
this store as ordinary deltas — the artifact on claude.ai is a **generated mirror** of it, never
hand-edited again. ADLC remains the source of truth for work; the board is always a projection
over it ("replace" was the wrong word, and Myk corrected it at sign-off).

### 34.2 The vocabulary

Two lenses, in `demos/board/vocabulary.mjs`, registered through the ordinary `/register` door:

- **`BoardItem`** — one entity per item (`board:pr-262`, `board:lane-t79`), six latest-wins props
  (`kind`, `title`, `seam`, `url`, `status`, `est`), all front-door writable. The **`boardEvent`**
  claim template makes a transition one authed call emitting ONE signed delta of exactly the
  declared shape — subject at `(item, status)`, one primitive value.
- **`Board`** — the singleton `board:main`. Its gather **expands the `item` role through the
  BoardItem reading**, so the whole board arrives at any reader as one resolved View:
  `{ banner, items: [<BoardItem view>…] }`. The **`boardAdd`** template files an item in one call;
  `items` is `all`-ordered oldest-first, so every filing survives and render order is history
  order.

Membership is explicit because Loam has no list-things-of-a-kind door yet — nothing can enumerate
"all BoardItems" (T110 owns that gap, and this board is its first customer). The dual of `all` is
stated plainly: each `boardAdd` is a distinct delta (H4), so genuinely removing a twice-filed item
means striking every membership delta that filed it. Which almost never matters, because:

**Nothing is removed to leave the board.** `status: shipped` IS the exit; the view filters. The
board's history is the point — erasure should essentially never touch this store (retention was
decided at sign-off: never prune), which is also what makes it the honest as-of demo.

### 34.3 Writers

Attribution is the product: every entry is a signed delta. Myk is the operator; sessions write
through the authed door as **granted authors** — not one fixed identity, a small set minted as
needed (`fable` first; the boot script makes the next grant a one-liner). The ungranted are
refused at the door, and the refusal leaves no delta behind. Revocation is one negation away, and
the board's own history is thereby an attributed record of who reported what, when.

### 34.4 The renderer, and the suppression obligation it carries

Route `board`, read-only, consuming `banner` + `items`; a **public declaration** (`loam.public`
over the `Board` lens) opens the page to tokenless LAN reads while the GraphQL door still refuses
tokenless writes — the anonymous surface has no Mutation type at all (§12). The declaration is
load-bearing: without it the route serves nothing and leaks no title.

Because `Board.items` reaches the anonymous door through an `expand`, the §21 child-resolver seam
carries an H1 obligation here: a struck BoardItem delta must vanish from the singleton's resolved
`items[]`, not merely from a direct read of the item. The substrate closes this — the expand
re-resolves each child over the full negation-closed set — and the rail pins it two-sided through
the public door (a struck status drops, a struck membership de-lists, a named live bystander
survives both).

### 34.5 The boot script is the operator path

`demos/board/boot.mjs --home <dir>` stands the whole application up from an empty home in one run:
operator identity (minted or adopted), both registrations, the fable grant, the renderer, the
public declaration, the first banner, and a `start.sh` beside the seed so restarting is one
command. Re-running is safe and is the **re-expression path**: the grant and declaration dedupe by
content address (H4), a lens bound with identical law is kept, and a lens whose bound law
*differs* is republished at the same entity — evolution — which is how the blessed script
supersedes a store whose law was improvised over the wire. The comparison is by canonical content
address (`termCanonicalHex`/`schemaCanonicalHex`), keyed on the PROGRAM name at both sides (H6).

### 34.6 The mirror

`scripts/render-board-artifact.mjs` queries the store's own door and renders with the **same
renderer module the store serves**, emitting the claude.ai artifact HTML on stdout — content
exclusively from the store, so the artifact can never disagree with it. The rail is two-sided with
a floor: the rendered title set EQUALS the door's own view set, an added item appears on the next
run, a string in no view appears in no artifact.

### 34.7 As-of

No route parameter in v1; the door already answers it: `boardItem(entity, asOf: T)` is "the board
as of yesterday morning" — the item's prior status after later transitions land, pinned by rail so
the §26 demo can never rot.

**Provenance.** Working spec [#265](https://github.com/bombadil-labs/loam/pull/265) (design,
Myk's sign-off with the four decisions: local persistent store at a home he names; granted
authors, not one fixed writer; never prune; the board is a projection, ADLC stays the source of
truth). Durable form landed [#272](https://github.com/bombadil-labs/loam/pull/272) —
`demos/board/` (vocabulary, renderer, boot), `scripts/render-board-artifact.mjs`, the §34 rails in
`test/board/`. The live instance came FIRST: stood up over the wire 2026-07-26 at Myk's own home
(port 5701) with an improvised flat vocabulary, and the durable form's boot script re-expresses
that store's law by design. Same-day dogfood yield: T110 (no list-things-of-a-kind door — the
board hit it within the hour) and T112 (the renderer drops mis-statused items; found by this
landing's own rail lens).
