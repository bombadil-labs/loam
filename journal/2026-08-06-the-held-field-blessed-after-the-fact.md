# The held field, blessed after the fact

2026-08-06. The overnight harness run widened `Gateway.federate()`'s return shape with a `held`
count (offered deltas the store already holds) while fixing T150's admin federate page, and edited
T64's frozen rail (`test/gateway/slate-doors.test.ts`, three exact `toEqual` shapes) to match — with
no authorization entry, on a direct push to main that never ran the rails backstop. The gate diffs
against a base only on pull requests; a push to main compares main to main and guards nothing. That
is the hole the edit rode through, not a defeated check.

The 2026-08-06 audit found it by running the backstop by hand against the pre-run base. Review
verdict: the arithmetic is truthful (`held = |crossed| − accepted`, unique-id partition), the change
is railed in `test/server/admin-federate.test.ts`, and no wire, CLI, or MCP surface emits the
report — only the admin page's own HTML. The design was larger than the ticket asked (a page-level
count needed no contract change), but the door is arguably the right home for the fact.

**Myk blessed the shape in chat, 2026-08-06,** choosing it over a revert. This entry is the record
of that blessing. No `rail-renames.json` entry accompanies it, deliberately: the edit is already in
every future base, so a pair would be inert from birth — and the first draft of one needed a
multi-line `to`, which the guard rightly refuses as malformed, and a malformed entry takes the whole
gate down for every later PR. A blessing of an already-landed edit is a fact for the journal; the
renames file is an instrument, not a ledger.

Residue, ticketed rather than lost: `loam pull` still prints only offered/accepted/refused, so the
CLI cannot say "already held" where the admin page now can — inconsistent, not false. And the
process hole itself — a direct push bypasses the rails backstop entirely — is the standing argument
for branch protection or a push-trigger variant of the gate.
