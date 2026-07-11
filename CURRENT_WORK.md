# Current work — between steps

_The tutorial step-through + in-order gating step is **done and merged** (PR #70,
2026-07-11). No step is in progress. Two items are queued; the next one to open is the
renderer task, and it opens at the PLANNING stage, not implementation._

## NEXT: shippable renderers — schemas AND their consumers, verified end-to-end

**Status: not yet fully scoped — START WITH DESIGN. Do not write implementation code until a
SPEC section is drafted and Myk has signed off.** (Myk, 2026-07-11.)

The idea (Myk's words, paraphrased): Loam already persists GraphQL schemas as deltas. Add a way
to **define and push _renderers_** — consumers of those schemas — as deltas too, so a "Loam app
developer" ships one bundle of deltas containing **both the schema and its renderers**, and Loam
can **verify at push time that the whole thing works end-to-end** (not hope it does at runtime).
A renderer might be a React component (or a set), a text format, whatever. Then the bundle just
needs to be **mounted** somewhere — and Loam could ship a **stock React host** against which
React renderers are **guaranteed to work**.

The hard questions to answer in the SPEC before any code (this is the real work):

- **What _is_ a renderer delta?** The source? A compiled artifact? A content-addressed
  reference? What's signed, and what does the signature attest to?
- **What does "guaranteed to work end-to-end" mean, and how is it _proven at push time_** rather
  than asserted? A renderer declares the schema(s)/fields it consumes; push-time verification
  checks those against the registered schema surface (the SurfaceGenerator seam from §17 is the
  natural anchor). Compatibility is a checkable relation, not a promise — pin down exactly which
  relation and how a mismatch is refused at the door.
- **Versioning** — renderers must obey the same law as every surface (§17): born versioned,
  append-only, a renderer pinned to schema version vN keeps working forever; evolving the schema
  can't silently break a shipped renderer. Work out how a renderer names the schema version it
  targets and what happens when that version is struck.
- **The trust/security model for shipping _executable_ consumers.** This is the sharpest edge:
  a renderer delta can carry code that runs in a host. Who may push one, whose renderers a host
  will mount, sandboxing, and the capability story. Federation makes this acute — a foreign
  renderer arriving over the wire must be inert-by-default like foreign law (§8/§12) unless the
  operator blesses it. Get this right in the design.
- **The stock React host** — what contract a React renderer implements so the shipped host can
  mount any conformant one; the "raw Loam + React app" deliverable.
- **Reference:** SPEC §17 (surfaces are materializations) is the closest existing machinery —
  renderers are, in a sense, the _read side_ of the same story. Read it first.

Plan the multi-agent shape too: Myk lifted the token budget (2026-07-11) — use a **specialized
review panel** (substrate/rhizomatic-semantics · capability/security · correctness/API) rather
than one generalist, for both the design critique and later PRs. See [[review-token-budget]].

Open at cycle stage 1: draft the SPEC section answering the above, then **STOP for Myk** before
implementing.

## ALSO QUEUED: hardening pass

Draft a new SPEC section (backend namespace marking, quarantine-vs-refuse for corruption, boot
resilience, entity-ID reserved-vs-user convention, `loam repair` tooling) per memory
[[hardening-pass-design]], then STOP for Myk's review before implementing — quarantine-vs-refuse
is his call. Smaller than the renderer task; can slot before or after it at Myk's discretion.
