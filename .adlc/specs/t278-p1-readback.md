# T278 P1 reconciliation and readback

Status: Myk answered yes to the initial availability limitation after this readback. Gate results are recorded separately.
The ADLC tooling proposal is shelved. Existing failed evidence remains intact.
This document reconciles direction; it does not authorize installation or rewrite history.

## Earlier direction retained

- Container relationships import deltas and registrations under scoped receiving policy.
- Curse withdraws law while retaining the deltas that comprise it.
- Live relationships carry later changes and source retractions. One-time imports do not.
- Deltas, including binding and withdrawal history, determine replayed state.
- T278 permits a standing bound connection to activate a received read-only renderer within its authorized container.
- Activation grants neither additional readers nor resolver, pen, dependency-adoption, or wider publication authority.

The first four points come from Myk's explicit conversation instructions, including
“It should always apply to all deltas within its relevant scope” and the distinction
between a live binding and a one-time import. The renderer direction is the approval
recorded in working design 62. This is a reconciliation, not a reconstructed count
of questions that cannot be substantiated.

## Proposed implementation sequence

Finish the channel prerequisite repairs. Then implement the current read-only
selection ticket: identify the exact received renderer and verify its current
source and destination law under the caller's actual binding. Selection executes
no code and writes no deltas. Later slices add confined admission, durable
activation and withdrawal, then authenticated serving and tool discovery.

Renderer code identity remains exact. Current lawful schema state is checked on
each selection; it is not silently replaced with a historical or root reading.
Revocation and withdrawal remain live checks. Intermediate results describe what
was recorded or selected; they do not claim a mounted application.

## Open product decision: incomplete received history

The current T288 implementation checks every ID recorded as received for the
current channel opening. If any such delta is absent, erased, or invalid,
localChannelEvidence returns unavailable. The selection ticket deliberately
inherits this rule. It therefore refuses selection even if the erased delta
appears unrelated to the requested renderer or is an older source registration.

This is a physical-erasure question. Ordinary curse and source retraction retain
bytes, and do not create this missing-history condition by themselves.

Recommendation for the initial slice: retain this conservative refusal and make
its availability cost explicit. Missing history is not evidence that the missing
delta was irrelevant. A more selective rule needs a sound dependency/negation
proof and a revised receiving-evidence contract before implementation.

Decision requested: is that conservative channel-wide refusal acceptable for the
initial version, or should receiving evidence be revised before proceeding?
Myk has now accepted this limitation for the initial version. The acceptance
comes from that actual answer, not from the earlier technical executability review.

## Evidence and next action

- Working direction: .adlc/specs/62-bound-renderer-activation.md.
- Current implementation: /tmp/loam-t278-local-events/src/federation/local-channel-events.ts, localChannelEvidence.
- Selection contract: /tmp/loam-t278-renderer-selection/.adlc/specs/63-received-renderer-selection.md, authority and complete source operand.
- Selection ticket: T-01M1X45D77VYGXWSYRG607C6S6; P1 remains incomplete.

After the actual answer, fold it into the canonical specification through the
ticket service. Complete the P1 readback and approval under the existing ADLC
workflow. Record only actual questions, answers and approval. Preserve the old
zero-question failure; do not install or use the shelved delegated-mode patch.
