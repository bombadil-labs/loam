# Plain words

Loam grew an idiolect: private words that readers find hard to follow. Myk ruled on 2026-09-25
that the refactor replaces them with plain words. This list is the one source.

## How to apply it

- Rename as you go. Every file you touch for any reason gets its words fixed in the same change.
- The work is greenfield, so wire strings and CLI names may change too. Keep an old CLI name as an
  alias where people type it.
- `spec/` is the historical record. Rename a section when you edit it for another reason, not in a
  sweep.
- Text for Myk, PR bodies, commit messages and new comments use the plain words now.
- Rhizomatic keeps its own list in `docs/vnext-language.md`, which follows this one.

## The list

| Old word | Plain word | Notes |
| --- | --- | --- |
| door, doors | endpoint (network); write path, read path (in code) | "append door" → "append path"; "federation door" → "federation endpoint" |
| ground | delta set | the pool of deltas an operation runs over; name the scope when it matters: "the store's delta set", "the peer's delta set" |
| law, constitution, constitutional | rules | registrations, trust, public lists, budgets |
| reading, readings | schema | rhizomatic's term; `expand.reading` stays as a literal key |
| pen, pens | renderer key | a renderer's separate signing key |
| slate | erasure request | the first phase of a two-phase erasure |
| the cut | erasure run | the second phase |
| graveyard | erasure record | |
| condemned | marked for erasure | |
| forgiveness, forgiven | withdrawn | a struck tombstone; the id stays refused |
| leeway | permissions | what a container may do |
| envelope | resource limits | Loam's pool limits; rhizomatic's storage-pack `envelope` is a different, literal name |
| blessing, curse | approval, rejection | adoption of foreign rules |
| mint, minted | create, issue | "mint a key" → "create a key" |
| seam | interface | |
| stock shelf | built-in schemas | `loam register --stock` may stay as a flag |
| rail, rails | test, tests | |
| voice | (remove) | "in the operator's voice" → "signed by the operator" |
| stranded | orphaned | |
| pulse | periodic check | |

## Kept

- **lens**: rhizomatic uses it, as in "offered lens".
- **home**: a user's own container. It is plain already.
- **custody**: "key custody" is the standard term.
- **hazard**: `SUBSTRATE-HAZARDS.md` names the list of known bugs.
