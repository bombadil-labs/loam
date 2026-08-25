# The sweep, and the paces

Two records from one day, neither carried by any single PR.

**The backlog told the truth again.** A fresh judge per five tickets read every pre-T200 shard
against main's current code: 30 live, 15 overtaken, 6 half-overtaken. The overtaken were not
abandoned work — every one had LANDED, most under other tickets' names, and the shards simply
never heard. Each is archived with the evidence of what covered it written into its body; the
half-overtaken carry a read-this-before-building note naming which half died. The lesson for
the process: landings update the tickets they realize, but not the tickets they happen to
cover — a periodic sweep is the only honest broom, and one evening of judges was its whole
cost.

**The paces were validated before they were promised.** Every command block in the operator
walkthrough ran against merged main before publication, and the validation itself taught two
things worth keeping. First: the erase receipt keeps its --reason forever, so a reason must
never contain the condemned content's own words — my first probe did exactly that and I spent
ten minutes suspecting sqlite's freed pages before finding my own fingerprints in the
tombstone. Second: `_hex` on a GraphQL answer is the VIEW's content address, not a delta id —
an operator hunting an id to erase has no CLI-native path to one (the admin container view or
the federate door are the routes today), which is a UX signal worth a future helper, not a
bug.

**Operational note, permanent:** the origin remote is HTTPS with gh-supplied credentials, by
choice — GitHub's ssh endpoint went unreachable mid-arc on 2026-08-21 and the HTTPS remote
survived everything since. Do not "fix" it back without a reason ssh can articulate.
