# T278 — Bound renderer activation: approved direction

Status: product direction approved by Myk on 2026-09-06 ("yeah this sounds reasonable").
Activation implementation remains pending. The prerequisite tickets have passed
their design gates. This working design does not change the landed spec or frozen rails.

Progress: T286 extracts shared live connection/channel authority. T287 introduces
explicit renderer contexts. Both passed independent P5 review. T287's final check
passed 3,200 tests, with five skips. Strict P4 remains incomplete because the flail
check has unresolved evidence. These are stacked
local changes, not landed activation or usable bound HTTP serving. Its error
boundary covers first paint and mediated reads: an operational bound read fault
releases neither HTML nor internal diagnostics. An empty entity and the ordinary
typed `not_served` response remain answers. Root behavior remains compatible.

## Product decision

Decided: container consent permits a standing bound connection to select and
activate a peer's read-only renderer inside that container without a separate
human click. A separate staged human approval is not required for this scoped act.
This permission must be explicit in the contract and user-facing consent
language. Hiding a tool from the operator's roster does not establish consent.

## Required behavior

- Discovery is identity-specific. Unbound callers receive no activation tool.
  Direct invocation independently refuses unbound and revoked callers.
- The caller names a channel admitted by its current binding and exact opening
  inbox. Check standing, source ownership, subtree reach, and governing leeway.
- Selection pins the full renderer identity, not just a mutable route or a short
  prefix. An intervening update refuses rather than choosing different code.
- Only renderer code is eligible. No resolver activation, implicit dependency
  adoption, pen authorization, or broader publication follows from this act.
- The execution context explicitly names the destination, law selection, data
  scope, requester and current envelope. Missing context refuses. It never
  chooses the primary/root view as a fallback.
- Admission and rendering use the existing confined worker path. Report its
  actual limits: compute and V8 heap controls do not guarantee total RSS bounds.
  The displayed probation banner is not browser confinement.
- A successful result describes the actual audience and usable route. A durable
  binding without a serving path is not reported as a mounted application.
- Serve-time authorization rechecks the activation's authority and container
  scope. Revocation, suspended ancestry and explicit withdrawal remove that
  delegated activation from serving. Bytes remain held. Independently authorized
  operator activations and unrelated containers remain unchanged.
- Activation, withdrawal and source identity remain separately attributable.
  Reopening reconstructs their standing from deltas. Operator-signed adoption
  must be an explicit administrative capability, not an implied signer change.

## Current implementation evidence

`src/server/http.ts` channelAdmits already checks the caller's standing, opening
inbox, opener standing and receive leeway. It is an invocation prerequisite,
not a complete renderer lifecycle.

`src/gateway/renderers.ts` channelApp selects a root-visible channel route without
those same opener/receive checks. The bound HTTP app door currently refuses every
bound caller because it otherwise resolves the root view. Adding a roster entry
and calling blessChannelApp does not fix either serving boundary.

`src/federation/channel.ts` blessChannelApp uses operator-authored manifest and
adoption claims in the channel pool. It enforces renderer kind, refuses implicit
dependencies, and supports an identity expectation. Its warning about unconfined
module initialization is obsolete: publishRenderer and prepareRoute now use
confined admission. Fix that comment when touching the implementation; do not
use it as the design's evidence.

The frozen T209 rail observes the operator-token tools list. Preserve it, and add
an independent direct-call refusal control. Merely making its list assertion
pass does not establish the new permission's safety or usefulness.

## T274 relationship and proposed sequence

T274 is `SPEC 59 - Make ground and operator explicit, never ambient`.
Ground and operator are not legacy. Ambient ground and ambient operator authority
are the problem. Its scope covers explicit read/write/root capabilities,
authority versus authorship, a complete access census, guarded compatibility
adapters, and deliberate public-API migration.

T278's product permission is now settled. Map its invocation, signing,
projection, serving and revocation requirements onto T274's census and capability
boundaries. Do not finish a roster-only implementation that embeds another
ambient root path just to close the sprint. The P2 decomposition should decide
whether a bounded renderer context can land before the wider refactor or should
be its first vertical integration slice. Do not freeze tests before that boundary
is settled.

Candidate rails must exercise actual activation and serving, refusal of direct
unbound calls, sibling/parent isolation, exact identity under a changing source,
resolver/pen/dependency refusal, live revocation, restart reconstruction, and
unchanged legitimate operator behavior. Code confinement controls remain active.

## Implementation sequence

Independent boundary review recommends three slices over the already-landed T263
behavior. Do not make T263's full completion a prerequisite of its own remaining
renderer work.

1. Explicit renderer context and shared authorization. Separate bound and explicit
   root variants. Cover ordinary and mediated reads, historical posture and live
   envelope lookup. Extract reusable standing/channel authority checks. Keep the
   existing bound HTTP refusal until the whole serving contract is available.
2. Durable activation and withdrawal. Record the activating connection, exact
   opening inbox, destination and full selected source identity separately from
   source content and any explicit administrative adoption. Reconstruct from
   deltas. Exclude pens, resolvers, implicit dependencies and automatic upgrades.
   Recheck the exact identity at commit. A library-only intermediate result says
   activation recorded, not mounted.
3. Bound serving and tool discovery together. Preserve direct unbound refusal and
   the existing operator roster. Check live authority before admission, after
   awaited work and before returning bytes. Deliver a usable authenticated route
   with the correct data/law context and test restart/revocation end to end.

Audience interpretation: activation applies within its destination container.
Readers must already be authorized for that container; activation supplies no
new read grant or public access. The activating connection's authority remains
separate from the identities allowed to read. Its revocation removes its own
activation support, not independently authorized activations of the same code.
This follows the approved separation of author, authority and reader scope.

Do not reuse the existing prefix-based expectation as an exact identity check.
Do not fix only initial node resolution while leaving mediated reads ambient.
Do not change the root CLI activation's persistent semantics while implementing
connection-lifetime activation.

Custody must distinguish an actual local receive from an imported receipt-shaped
delta. Existing mixed channel storage cannot prove that distinction by signer
alone. Independent review recommends a new reserved local-event family in the
existing primary, with a narrow local writer and mandatory generic append and
federation exclusions. Protect its opening/lifecycle evidence as well as receipt
records. Replay remains delta-driven. This avoids the additional storage inventory
obligation of a separate receipt backend; it does not waive ingress, bootstrap,
restore, erasure or source-negation requirements. T288's detailed P1/P2 gates
passed. Its initial 73 test cases are frozen at local commit `ba46c62`.
Three additional cleanup and opening-race cases are frozen at `0b2ad72`.
The initial suite failed to load because the new module was absent; the separate
existing-API fixture probe passed. The added regressions reproduced real source
failures before repair. Source checkpoint `a76dd0c` passes the full repository
check: 3,276 tests pass, with five skips. The first independent P5 round
verified three mechanisms requiring repair: closed resumed handles lose their
opening identity, legacy handles accept replacement declarations or attachments,
and the exported receipt writer accepts caller-selected IDs. All four deduplicated
findings were recorded before fixes. Twenty additional cases are frozen at
`6c108d8`; nine reproduced behavior failures and eight required the new receive API.
Three positive controls passed. Repair checkpoint `efeb749` passes 3,296 tests,
with five skips. An earlier full run had one timeout while mutation testing ran;
the unchanged-source repeat passed with that workload paused. All failed evidence
remains recorded. Fresh independent P5 review is running against this checkpoint.
An independent design addendum confirms the receipt repair: actual offered deltas
pass through admission before a private writer records their receipt. Open/close
issuance refuses the former received action at runtime. Mutation testing remains
in progress. Strict P4 still lacks accepted flail evidence.
Existing channels retain legacy behavior; resume
does not manufacture protected receive evidence. A fresh lifecycle records its
exact opening and pool declaration. Supported restore preserves that local history;
ordinary content import cannot create it.

Live received source-author retractions retire delegated activation support and
retain source bytes. Select both bindings and retractions from the receipt-scoped
received lineage. Serialize its receive commit and exact activation selection per
channel incarnation. Queue state only orders operations; it grants no authority.
Current grant, scope, source bytes and support deltas determine standing on replay
and serving. Concurrent withdrawal may leave an inactive recorded support; do not
claim that an asynchronous append can be rolled back.

T274 starts from a census of the actual post-sprint implementation, including
this renderer boundary. Its broad migration remains a separate architectural
parent; neither this approval nor a renderer-only type establishes its full
context design or lifecycle gates.


The next bounded slice selects exact received renderer and current-law metadata.
Independent design review found this read-only slice executable. It performs no
admission or persistence. A later cohesive slice performs actual confined admission
and private support/withdrawal persistence inside ingestion. This split keeps the
privileged writer behind the actual checked operation. Complete received evidence
still governs selection: erasing any received source member makes it unavailable,
even when a newer valid registration exists. Later support listing must refuse a
missing expected inbox rather than return an apparently complete partial list.
These are local implementation plans, not landed behavior or completed T278.


P1 reconciliation: Myk accepted the conservative initial availability rule after
the readback in `.adlc/specs/t278-p1-readback.md`. Physical erasure or loss of any
attested received member makes selection unavailable for that channel opening.
Ordinary curse and source retraction retain bytes and do not themselves trigger
that missing-history condition. The selection ticket now passes the unchanged
ADLC P1 gate with one actual question and Myk's affirmative answer. The earlier
zero-question failure remains in the ledger. The delegated-approval tooling
proposal is shelved and was not installed. This approval does not complete the
outstanding T288 implementation gates or authorize claiming mounted serving.
