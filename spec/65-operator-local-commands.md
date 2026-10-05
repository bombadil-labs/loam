# §65 — Operator-local commands over the existing journal

An operator can import ordinary facts and evaluate an explicitly pinned reading through
Rhizomatic command profile 1. `openOperatorCommands(gateway, installation)` opens over the
gateway's existing own-key journal and signer. It takes one original signed endpoint
configuration and its two signed operation declarations; the configuration's caller is
exactly this operator. The signer keeps custody of its seed. The shipped dependency is
`@bombadil/rhizomatic` at the exact registry version `0.11.0-next.7`.

This is a local operator trial. It has no HTTP endpoint or bound-connection method, and an
admitted journal snapshot does not represent every user's authorized ground. Existing
GraphQL reads, registrations, resolvers and erasure services retain their own contracts.

## A chosen head, checked once

The service's `head()` observes the current journal head. Each `run()` job supplies its own
`expectedHead`; observation does not silently choose that expectation for a later invocation.
A competing durable write produces a signed precondition or write-conflict refusal. There
is no retry against a newer head. If the caller selects a current durable head while the
gateway's reactor is stale, the service asks the caller to refresh first.

The job, guard checks and command use the same admission queue as append and one captured
receive time. Retain runs append's standing, quota, permanent refusal, erasure and slate
citation preflight before the journal CAS. A completed retain refreshes the gateway from
the admitted rows. Arrival attribution remains Rhizomatic's unattributed retain; this door
does not replace local write or effective-erasure semantics. Store or signing faults remain
visible, including faults after a durable commit.

## Facts in, original reading support out

A retain job supplies `kind: "retain"`, `expectedHead` and signed `payload`. The import
refuses reserved Loam law references, definitions, negations and transaction manifests,
including control semantics expressed through pointer roles or targets. Those acts belong
to the existing services that own their activation and provenance.

An evaluate job supplies `kind: "evaluate"`, `expectedHead`, `at`, `root`, original signed
`hyperschema` and `schema` acts, their `hyperschemaPin` and `schemaPin`, the exact dependency
closure in `definitions`, and primitive `bindings`. Source is `admitted` and interpretation
is `core/1`. The original authors and program pins are preserved; support acts are neither
re-authored nor admitted. Incorrect pins and incomplete closure produce signed refusals.
The service returns the signed request, verified receiver-signed outcome and decoded result
View. Reopening the SQLite store and explicitly reconstructing the same installation can
evaluate the retained facts again.

Evaluation refuses while any read closure over this gateway's own ground is active. This
conservative whole-source limit preserves slate and erasure read exclusions; it is not a
general scoped-serving implementation. Profile 1's resolved View does not replace Loam's
gathered HyperView or its resolver and live-registration path.

## The same service through the CLI

`loam command --home HOME --installation FILE --request FILE` opens the actual home's
SQLite peer using its existing signer. The installation JSON contains `configuration` and
`declarations` in Rhizomatic's signed Delta JSON profile. The request JSON contains one of
the jobs above; `definitions` is an array and `bindings` an object even when empty. The CLI
prints the signed request, signed outcome, status and decoded view when available. Unknown
flags, including remote and bound-connection options, are refused before invocation.

**Provenance.** Supervised command-consumer landing (PR link to be filled when the PR is
opened). Implementation: `src/gateway/operator-command.ts`, the shared preflight in
`src/gateway/ingest.ts`, and `src/cli/command.ts`. Proof: the nine actual SQLite and CLI cases
in `test/gateway/operator-command.test.ts`, covering reopen, foreign definitions, pins and
closure, competing writers, slate/refusal/quota/law guards, and refusal of remote modes.
