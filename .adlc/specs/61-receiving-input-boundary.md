# Receiving input and custody boundary

Status: design investigation following the T281–T283 pure proof. This is not a
new wire protocol or authorization to migrate every existing container.

The recipient must know which accessible deltas constitute its administration,
which constitute a source's statements, and which belong to an evaluation
operand. Signer equality cannot establish those distinctions. A source signed
by the recipient's own operator remains a source.

## Concrete current paths

| Path | Present behavior | Receiving constraint |
| --- | --- | --- |
| `gateway.ts`, `Gateway.open` | Replays the entire backend, then registrations and resolver modules | Raw source storage must never be opened through this path |
| `gateway.ts`, `reseat` | Replays the backend again after destructive maintenance | Ingress filtering alone cannot preserve isolation |
| `container.ts`, `openSeparate` | Settles parent erasure debt, opens a Gateway with the operator seed, seeds authority, attaches a pool | This is an owned governed child, not a borrowed source handle |
| `container.ts`, `resumeInboxes` | Reattaches persistent child Gateways from declarations | Source attachment needs a distinct replay path |
| `lifecycle.ts`, `boundBindingsImpl` | Reads registrations from child/channel Gateways and carries `channel` into bindings | Law provenance and evaluation operand must be distinct inputs |
| `reads.ts`, `boundGroundFor` | Gathers the bound destination scope and applies closure/negation | Imported selected law must read this common eligible operand |
| `erase.ts`, `readGrounds` | Enumerates readings through Gateway children | A raw held store has no executable readings of its own |
| `erase.ts`, erasure fan-out and standings | Visits Gateway replicas, checks bytes and local tombstone receipts | Physical custody must remain enumerable without inventing source authority or receipts |
| `slate.ts`, closure and settlement readers | Resolves operator claims against the gateway reactor | Source administrative claims must never enter that reactor |

The same constraint covers grants, trust, public exposure, declarations,
registration/lifecycle and resolver restoration. Filtering selected registrations
is insufficient: the foreign administration would already be present.

## Chosen direction

Separate three handles rather than adding a trust flag to `Gateway.open`:

1. **Source reader:** authenticated stable source identity plus a read-only view of
   verified held deltas. It has no signing, governing, serving or purge operation.
   Identity is supplied by the authenticated boundary, never inferred from author.
2. **Owned custody target:** physical byte inventory and explicitly scoped local
   maintenance capability. A received copy can be owned; the original shared or
   borrowed source is not thereby owned. No reader-to-purge conversion exists.
3. **Recipient context:** receiver-owned administrative deltas and the explicit
   destination. Bindings, modes, curses and local tombstones derive here. Source
   bytes do not enter this context even when their author equals the receiver.

A persisted binding resolves a stable source identity through the existing style
of backend factory. A missing source is named unavailable, never an invitation to
open primary storage or reuse an ordinary child Gateway. The factory chooses a
physical handle; it does not choose blessing, scope, mode or curse policy. Those
remain delta-derived. Live arrival changes held source deltas without requiring
another receiver signature. One-time selection remains exact.

Owned source copies remain visible to local byte accounting and applicable
existing erasure obligations. Their imported tombstone-like claims do not become
local deletion commands. Local anti-resurrection policy comes from recipient
administration; a raw source store need not contain a fabricated operator marker
or duplicate local tombstone to participate in physical inventory. Unreachable
owned storage prevents a clean erasure claim. A borrowed original and bystander
stores are never purged because a destination imports from them.

Do not place owned source stores outside the inventory and call that isolation.
Do not wrap raw stores in dummy Gateways merely to satisfy the inventory type.

## Smallest useful sequence

0. Completed bounded prerequisite T285: extract read-only physical retention
   probes from administrative erasure receipts. This adds neither an inventory
   registry nor source attachment. Full check: 3,223 passed tests, five skipped.
1. Specify and test physical custody inventory separately from executable Gateway readings.
   Preserve current child-Gateway inventory behavior as a positive control. Add
   a raw retention probe with no administrative reactor. Inventory membership
   alone cannot confer purge, discard or drop capability. Keep receipt delivery,
   reseating and destructive traversal on existing Gateways. A separately reviewed
   owned-custody capability is required before raw copies can accept source traffic.
2. Add verified raw held-source ingestion and cold attachment using those handles.
   Admission checks recipient local tombstones without interpreting incoming
   administrative claims. Test boot, reseat/reopen, partial storage failure,
   unreachable owned storage, same-author attacks and unchanged legitimate local
   controls. No resolver loads during attachment.
3. Construct pure receiving inputs from local decisions and held source snapshots.
   Reuse T281/T282 unchanged. A missing dependency stays named unavailable. Project
   selected law separately from the common destination data operand.
4. Add scoped declarative evaluation and source-relative dependencies. Keep
   provenance separate from `Bound.channel`; preserve authorization for writes.
5. Migrate local-container and transport adapters through the common receive path,
   with explicit changes to the legacy federation toggle rails when warranted.
   Onward send/export policy remains a separate decision and contract.

Each slice needs its own measured new rails and review. None requires adopting
all of the T274 context refactor first; none may introduce a second ambient
operator or bypass its intended authority separation. Existing public APIs and
wire records remain unchanged until the relevant adapter/migration slice.

## Required story controls

A receiver and source use the same signer. The source contains a schema plus
claims that would grant a stranger access, change trust, expose a private
container, register executable code, or declare destructive administrative law.
Receiving retains the source bytes and can select its declarative schema, while
those administrative effects remain absent before and after cold attachment.
The equivalent legitimate local decisions still work. A local curse withdraws
only adopted law and leaves bytes held. An applicable local erasure reaches an
owned received copy and refuses a false clean when its storage is unavailable;
its borrowed original and unrelated bystander remain byte-identical. Live source
updates and lawful retractions change projection without a receiver signer.
