## 45. Pens — provisioning a renderer's signing key

A write-enabled renderer (§23.3) signs its form POSTs as a **pen** — a separate, revocable identity,
so a page on a public route never signs with the operator's own key. The gateway learns a pen's seed
through `GatewayOptions.pens: Record<name, seed>`, and until T102 landed that map was reachable only
from an embedding script: a pure-CLI operator could publish a write-enabled renderer whose form
answered 403 forever, which the operator review hit on its first two-store run. This section is the
CLI's answer — how a pen is provisioned on disk, how `loam serve` picks it up, and what
`loam pen create` promises about the key it handles.

### 45.1 The file IS the provisioning

One file per pen, `pen.<name>.seed`, in the home, beside `operator.seed` and the `user.<name>.seed`
files — same 0600 mode, same law: the seed never enters the ground, and **the filesystem is the
trust root**. The file's contents are a 64-hex seed and nothing else; its *name* is the
provisioning. `loam serve` reads every `pen.<name>.seed` at boot — the same moment users and
credentials are read — and hands the map to `Gateway.boot` as `GatewayOptions.pens`, keyed by the
`<name>` a renderer binding cites (`pen: "<name>"`). The boot summary names the provisioned pens, so
"is my pen provisioned" is answered at boot rather than by the first 403.

The read fails loudly in both directions (H9). A pen file that exists but cannot provision — an
unreadable file, or one that does not hold a 64-hex seed — is a **fault on the operator's log,
never a silent skip**: a skipped pen would surface only as a 403 on the first form POST, which is
exactly the twenty-minute puzzle this convention exists to end. And only "there is no home yet"
means "nothing is provisioned"; a home that exists but cannot be *listed* leaves the pen set
unknown, and an unknown set is reported as a fault covering every pen, never as an empty one. What
counts as a provisioned seed is one predicate shared by `serve` and `pen create`, so the two cannot
disagree: a create that accepted what a boot rejects would mint a pen dead on arrival.

### 45.2 `loam pen create` — three facts, decided together

A pen has three facts, any of which can exist without the others — a crash between two writes, a
hand-copied file, a deleted seed:

- **Custody** — the seed file. Whoever holds it can sign as the pen.
- **Authorization** — a write grant on the ground for the seed's derived author, read *at the verb*:
  a grant naming the author is not the same fact as a grant naming it FOR WRITE, and reading the
  loose question would take an `admin` grant as write standing the door then refuses.
- **The pen record** — a ground delta at `pen:<name>` (context `loam.pen`) naming which author this
  NAME is supposed to sign as. The record is what makes replacing a leaked key *complete*: without
  it, a replaced key keeps its standing under an author derivable only from the file that is gone.

`loam pen create <name>` reads all three before anything moves, and lands the seed file *before*
the grant (the `user create` ordering, for the same reason: a crash between them leaves a state a
re-run repairs, never a live grant whose freshly-minted key was lost). The name is checked as a
single path component before any path is built from it. Three outcomes:

- **Provisioned** — nothing existed. A fresh seed is minted at `pen.<name>.seed`, the pen record and
  the write grant land as operator-signed deltas.
- **Repaired** — the seed file exists but its author holds no grant (a crashed earlier run, or a
  hand-planted file). The missing halves converge: record and grant are planted for the file's
  author. If the file was hand-*replaced* — the ground still carries a record naming a different
  author — the repair reaches the same stale-record loop as a re-key and strikes the old standing.
- **Re-keyed** — the seed file is gone but the record survives; this is the documented answer to a
  leaked seed. A fresh key is minted, and the old author's record **and every surviving grant it
  held — any verb —** are struck: a key being replaced because it leaked must not keep signing
  anything at all. Past writes stay attributed to the old key; the door refuses the old seed even
  restored to its own file, because the record now names the new author.

Two states refuse rather than converge, and the distinction is a struck grant versus an absent one.
An already-provisioned pen (surviving write grant) refuses a second create — nothing overwritten, no
second grant. A **retired** pen (grant struck on the ground) also refuses: re-planting would
un-revoke a standing somebody deliberately revoked. The command asks the ground for both sets,
never its own run's memory. And because serve reads pen seeds only at boot, a create under a live
server warns that the running process will not see the pen until restart.

### 45.3 What the reports promise

The command handles a secret, and the rails pin its honesty on three sides. **The seed never
prints** — not in the success report, not in any refusal. **A refusal never quotes the file**: the
not-64-hex refusal explains the test and names the cure, but a string that fails the test may still
be a key, and a refusal is no place to print one. And **a run that struck a key says so, whichever
arm it took**: the re-keyed report lists each retired author with the count of grants that no longer
bind, and since PR #406 the repaired arm carries the same strike lines when its stale-record loop
fired — a report that is true and materially incomplete about a revocation is H7's shape at the CLI
layer. The promise is two-sided: a grant-only repair prints *no* strike line, because trading an
incomplete report for a false one is not a fix.

The unprovisioned-pen 403 splits by door for the same reason the seed never prints: on the token
door the refusal names its cure — the pen's name, the `pen.<name>.seed` convention, the
`loam pen create` command — while the anonymous door answers the uniform "the write was refused",
because the pen's name and the store's file layout are the operator's business, not the anonymous
fan's.

### 45.4 What is not here

T102 remains open, and its remainder is ticketed there — a reader should not infer any of it from
this section: the publish-time warning when a renderer binding names a pen no file resolves,
`loam store` listing provisioned-versus-granted pens so the two-sided requirement is inspectable,
and the README's federation sentence about rostering pens. Separately, T161 names an open edge on
the quarantine boundary: §24.7 opens a pool with the primary's pen seeds so a probationary app can
write at all, but the *whole* pen table crosses, so a stranger's quarantined renderer may name any
provisioned pen — the per-request root-standing check confines revocation, not selection. That
confinement is T161's to close, not this section's to claim.

**Provenance.** Core landed [#367](https://github.com/bombadil-labs/loam/pull/367) (T102, Myk's
merge — the file convention, `loam pen create`, the serve boot path, the two-door 403); the
repaired arm's strike report landed [#406](https://github.com/bombadil-labs/loam/pull/406) from the
post-arc audit. Implementation: `penSeedPath` / `writePenSeed` / `readPenSeed` / `readPenSeeds` /
`isSeedHex` in `src/cli/config.ts`, `cmdPen` in `src/cli/cli.ts`, the pen record vocabulary
(`CTX_PEN`, `penEntity`, `penRecordClaims`) and the two-door refusal in `src/gateway/renderers.ts`.
Rails: `test/cli/pen.test.ts` (frozen — the three facts, both levels: the landed write is authored
by the pen, and the door's answers) and `test/cli/pen-repaired-report.test.ts` (the strike report,
two-sided).
