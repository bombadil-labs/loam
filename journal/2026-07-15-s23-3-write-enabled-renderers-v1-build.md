## 2026-07-15 — §23.3 write-enabled renderers, v1 build: a face that writes

The fourth and last §23 build slice (stacked on T11) — and the sharpest, because it opens a new WRITE path.
§23 v1 renderers only read; §23.3 lets a rendered `<form>` POST and the store sign the resulting delta as a
per-renderer PEN — a granted-author identity provisioned in config, never the caller's key. Provenance thus
shows the mediating code, and revocation strikes the pen's grant.

The custody model is §6's two keys, transcribed to the screen. A renderer binding gains `writable` (the
form's field allow-list) and `pen` (the granted-author name), plumbed at rest exactly like `consumes`. The
pen's SEED lives in `GatewayOptions.pens` (config, keyed by the binding's pen name) — CUSTODY; the binding
carries only the NAME, never the seed, so the ground never holds a signing key. And the pen must ALSO hold an
operator GRANT of write standing — AUTHORIZATION. `Gateway.writeRoute` signs the form-submit AS the pen via
the normal §14 `mutateEntity`, so `append`→`authorize` re-checks the grant on every write: a
provisioned-but-ungranted pen writes nothing, and revoking the grant refuses future writes while every past
write stays attributed to the pen. The two keys are genuinely independent — a test proves each failure mode.

Three decisions worth recording. (1) A form's fields are a NARROWER writable than the schema's own: the
door refuses a field outside the renderer's `writable`, and `mutateEntity` independently re-checks the
registration's `writable` — two gates, the renderer's atop the schema's. (2) No anonymous write by default
(§12) falls out of composition, not a new rule: an anon form write needs the operator to have done all three
of declare-public + provision-pen + grant-pen; miss any one and it is 404 (route not visible) or 403 (pen
not provisioned / not granted). The village act walks exactly that: an anonymous POST lands only once all
three are present. (3) `writeRoute` reuses serveRoute's visibility discipline (a new `routeServableOn`
helper), so a stranger can only POST where they could GET — an undeclared route stays a uniform 404 to a
write probe too.

The honest gap, named in code and spec: the §19 write-path label `renderer` has **no representation on
deltas anywhere in the codebase today** — a delta is `{ timestamp, author, pointers }`, distinguished only
by its author (which seed signed it). So "labeled `renderer`" is realized as the PEN'S AUTHORSHIP: a
renderer write is the write signed by that renderer's provisioned pen, and provenance reads the pen. A
formal §19 four-way label enum is separate future work; I did not invent one, because inventing an on-wire
label the rest of the system doesn't read would be a lie dressed as rigor. And the USER'S-OWN-PEN
(non-custodial client signing) path needs the browser host — deferred to that slice, as designed.

Learning: the map's most valuable finding was a NEGATIVE one — grepping for the §19 label proved it doesn't
exist, which turned "implement the renderer label" from a build task into a spec-honesty task (say what IS,
which is pen-authorship). A write path's real surface is the two-keys separation and the compose-not-add
§12 story; both were provable with focused rails rather than new machinery. The one harness change (openStore
gaining an optional `pens` config) is the village's way to hold a pen's seed in a demo store's home.

`npm run check` green — 602 tests (test/gateway/write-renderers.test.ts 7: pen authorship asserted against
the landed delta's author; the writable door-gate; read-only refusal; provisioned-but-ungranted refused;
revocation with past-attribution preserved; and the anonymous-write gate both directions). Village act
demos/village/phase-guestbook.mjs (A FACE THAT WRITES, 2/2) exercises the anonymous form POST + revocation
end to end over HTTP. Additive/non-breaking (a renderer with no pen is the pre-§23.3 shape) → no §20
migration. New write path + pen-custody model → Myk's merge (P6), opened stacked on T11.

---

### Arc note — the four §23 build slices (T9–T12), one night

T9 (byte-door), T10 (pinned-public), T11 (renderer sandbox), T12 (write-enabled renderers) were all built,
tested, village-demonstrated, and PR-opened in one session, each stacked on the last (they share
gateway.ts / http.ts / spec/23, so the forecast serialized them). None self-merged: every one touches a
capability / erasure / anonymous-door / write surface the standing rules (and the auto-merge classifier)
reserve for P6 — so all four are opened as a stack (#102 → #103 → #104 → #105) for Myk's review, in merge
order. The recurring pattern across the four: each new SURFACE (a raw-bytes door, a pinned-public
declaration, a sandboxed executor, a write pen) rode existing seams — serveRoute's read discipline, §17's
version freeze, the §14 mutate path, §6's two keys — so the novel code was small and the real work was the
sweep for what the new surface touched (every view→JSON site; the truncated public family; the browser
bundle's no-`require(` line; the §19 label that doesn't exist).
