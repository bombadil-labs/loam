## 52. The stock shelf declares its references

The shelf's three "who" properties — `org.members`, `event.attending`, `person.follows` — are
declared references (§51 `refs`), each serving its typed link/unlink pair and offering no
primitive argument. The section exists because slice 1 of the stock graph merged one PR before
§51 landed, and the gap taught the exact fossil the introspected surface must never teach: a cold
client wrote `follows: "person:bob"` because that was the only door offered.

Three shapes of care hold it together. The §14 `link<Type>` verb is refs-aware, but only on
AGREEMENT: the bypass fires when the declared role matches the role the verb would mint, and any
mismatch falls back to the read-only refusal — so the generic door can never author an edge the
typed doors cannot retract. Legacy data survives on both sides: §14-written `members` edges keep
resolving through the unchanged role, and primitive values written before the retrofit keep
resolving in the mixed array beside nested views. And `person.follows` reads FLAT by design —
refs with no expand, an entity pointer resolving to the bare id — which is what let the frozen
depth rail evolve by a single declared substitution instead of a rewrite. The pin tables carry the
refs verbatim, with the shelf-wide law that a reference is never also writable.

**Provenance.** Ordered front-of-line by Myk (2026-08-27), coordinated with the stock-graph
session (T244); realized by T246 in two phases — PR #485 (members and attending, the refs-aware
§14 verb, the compat rails) and PR #486 (follows, through the rail-renames ceremony authorized in
PR #483). Implementation: `src/stock/index.ts`, the role-agreement selector in
`src/gateway/mutate.ts`. The rails are `test/cli/stock-refs.test.ts` (frozen at this landing) and
the evolved `test/cli/stock-depth.test.ts`.
