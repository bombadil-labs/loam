# Section 60 — Evidence and independent design review

T280, P1 exploration, 2026-09-05. Baseline `62ee3e9` on
`design/container-receive-policy`. No runtime implementation or rail revisions.

## Investigation

Two independent read-only ADLC explorers inspected receiving/law policy and
container/MCP composition. Both independently identified the same-operator source
filter in `bindArrived`. Their evidence is incorporated in the working spec's census.

The shared seam already has useful implementations: `ChannelSource`, verified
replication, receiver-authored adoption, durable curse, and custody/recovery. It does
not yet have a complete local sharing or container-scoped onward-offer implementation.
Existing planned T264/T265 contracts, not an inferred already-shipped feature, own
those stories. The proposed design coordinates with them and T274.

Exact baseline command:

```sh
npx vitest run test/federation test/gateway/bound-fold.test.ts test/server/federate-mcp.test.ts test/server/subtree-receive.test.ts
```

Result: 41 files passed, 268 tests passed, exit 0. Full local log:
`/tmp/loam-receive-design-baseline.log`. The reviewers inspected source and existing
tests; they did not independently rerun this measurement. The whole `npm run check`
was not run for this design-only change. T214/T224/T235 are related recorded concerns,
not newly reproduced bugs or claims of fixes in this work.

## Independent premortem, round one

A fresh-context reviewer received the written design, source/test access and
`src/gateway/SUBSTRATE-HAZARDS.md`, without the author's exploration transcript.
It preferred the explicit receiving relationship to both an adapter-only approach
and a universal-engine rewrite, but found six substantive gaps:

| Finding | Evidence / failure | Disposition |
| --- | --- | --- |
| Constitutional isolation incomplete | `ingest.ts` shared-seed assumption; trust/grant/container/erasure readers consume operator-rooted state, not merely registrations | Amended: isolate all constitutional inputs before same-author ingest; slice C prerequisite and expanded observable authority rail |
| Nested reading names unresolved | `lifecycle.ts` resolves embedded `expand.reading`; hazard H3 makes those names part of content-addressed bodies | Amended: relationship-local original-name registry, no silent rewriting; two-source `Person` fixture with root/destination decoys |
| Live imports confused with replacement | `channel.ts` parks changed law at occupied names; `adopt-law.ts` requires explicit supersession | Amended: live data/discovery separate from automatic replacement; recommend explicit replacement, pending user decision |
| Source withdrawal lifetime unspecified | Local adoption has new IDs, so striking source registration does not automatically strike adoption | Explicit user decision; recommend source-dependent live adoption; new registration-lifetime rail, separate from data retraction |
| In-flight policy stale | Fetch/persist awaits can outlive curse, detach or authority changes; existing severed-channel hazard | Amended: generation/freshness checks and publication linearization, with controlled race rail |
| Persistence promise overclaims atomicity | Awaiting backend append proves ordering, not absence of partial durable writes on rejection | Amended: distinguish effective publication from bytes; partial-write/reopen recovery fixture |

These are design findings, not independently reproduced production failures. Round
one prompted changes rather than an invented clean verdict.

## Independent premortem, round two

The reviewer found all six original findings addressed at design level and no
additional migration-order contradiction. It requested two clarifications, both
incorporated: the private dependency registry must resolve only effective recipient
adoptions (cursing `Person` also blocks a dependent movie expansion), and disabling
auto-bless must not imply immunity from the separately chosen source-withdrawal
policy. Criterion 7 now tests the cursed dependency and an unaffected other source.

Its verdict: suitable for discussing the explicitly open product decisions, **not
implementation approval**. The two final wording changes implement its requests;
no separate third review or claim of runtime verification is implied.

## Further autonomous pass: live bindings and replay

Following the user's scope, live/one-time and delta-derived-state decisions, the
independent reviewer identified five mechanical requirements: exact persisted pause
selection; source lineage distinct from hash/alias; complete dependency-generation
publication; per-adoption rather than merely per-relationship dependency maps; and
cold replay separated from signing reconciliation. All five are now explicit in the
working spec's claim/projection contract and acceptance criteria 15–17.

A second read-only audit checked snapshot/version primitives. `freezeMembers` is
order-free but does not deduplicate arbitrary arrays; `ModuleVersion` is not a
durable manifest; registration version pins do not freeze the whole hyperschema
definition; current custody attestation follows binding rather than gating it.
The working spec records these limits instead of assuming those existing primitives
already implement the new contract.

Additional exact baseline command:

```sh
npx vitest run test/gateway/container-identity.test.ts test/gateway/freeze-narrowing.test.ts test/gateway/pinned-public.test.ts test/gateway/public-pin-chain.test.ts
```

Result: 4 files, 26 tests passed, exit 0. Log:
`/tmp/loam-receive-snapshot-baseline.log`. These tests validate existing primitive
behavior; no new receiving implementation or new production test is claimed.

The independent follow-up found no direct contradiction in the new mechanics and
requested two projection clarifications. Both are incorporated: validate historical
publication against its referenced governing decision while evaluating present
eligibility under later policy; and never let a concurrent-decision contest neutralize
a valid curse or revocation. Criterion 17 includes these cases. As before, this is
design review with named product questions still open, not implementation approval.

## Simplification after retraction clarification

The next independent review rejected a requirement introduced in the previous pass:
mandatory signed adoption-publication claims for every live revision. The reviewer
explicitly corrected its earlier recommendation. A standing live binding already
authorizes following source law; requiring a new receiver signature recreates an
unnecessary second authority step and crash-recovery burden.

The current design therefore supersedes the earlier three-record/publication-DAG
proposal. Live law is a pure projection of eligible held claims and receiver policy.
Exact persistent selections remain for one-time imports and pauses. Dependencies
may evolve independently unless actual claims declare a shared immutable release;
an authoritative reading with unresolved references refuses deterministically,
rather than retaining whatever a process happened to serve before. Pause does not
ignore received retractions or permit replacement outside its exact selection.

The final independent check found one stale receipt-gating sentence, now corrected:
receipt write failure cannot change effective law for an otherwise identical held
claim set. No other material contradiction was reported. Earlier review findings
and amendments above remain history, not the current recommended contract.

A separate read-only rail census found one direct scope conflict: T200's identical
law/two-peer fixture explicitly requires heights 11 and 22 despite both channels
entering `friends`. Under the decided common scope and its timestamp-pick policy,
both should resolve 22. The proposed revision retains both aliases, genuine reads,
honest reports and outside-scope protection. The frozen-adoption, distinct-incumbent,
private-primary, pause and curse rails remain safeguards. Exact paths/cases and base
ticket owners are in the working spec's rail table; no rail was edited.

The working spec now names four proposed implementation contracts: pure policy
projection, explicit constitutional/data input construction, scoped evaluation,
and ingress/mode adapters. This is a concrete P2 proposal, not a populated/approved
implementation DAG. The first proof can run without source migration or export work.

## Current gate limits and remaining decisions

T280's cold-start audit is scoped to **performing design exploration**, which a
fresh agent can execute without a product decision. It does not say the eventual
implementation is executable before the open questions are answered. The P0 CLI
assertion passed after recording the current ticket hash.

Spec-lint checks whether acceptance criteria name verification; the test paths in
this draft are proposals and remain undeclared rails. A pass does not prove those
tests exist, ran red, or establish the proposed semantics. No P3–P6 evidence is
claimed for this design.

After this review, Myk settled receiving-data scope: adopted law always applies to
all deltas within its relevant scope, irrespective of provenance. The draft now
removes the source-only toggle, tests local and other-source records, distinguishes
dependency-law identity from its data operand, and identifies a separate existing
channel convergence slice. The further autonomous review above covers this decision
alongside the live-binding and replay mechanics.

Myk subsequently settled revision following: live container bindings automatically
follow schema revisions; one-time imports retain their imported selection. Bindings
and their policies are delta-derived, and cold replay must reconstruct effective
state. This supersedes round one's provisional manual-replacement recommendation.
The draft adds a replay invariant and a live-versus-one-time behavioral rail,
including arrival permutation, duplicates and discarded caches. The further review
above challenges the resulting mechanics and records the amendments it required.

Myk also clarified that source retractions are ordinary deltas flowing downstream
over live bindings. The design now removes the separate withdrawal-policy question:
source survival/fallback/revival follows lawful received claims, while recipient
curses still govern local adoption. Criterion 14 and the replay table carry this
decision. The simplification review above subsequently covered it.

Onward export without promotion still needs a concrete contract and review. Alias
and relationship-recreation curse behavior needs an explicit rule before that slice.
Full integration decomposition remains pending. Myk subsequently
authorized the bounded pure live proof and routine autonomous decisions; T281 now
owns that implementation separately from this design ticket. PR #557 and its
frozen rail have not been changed or approved by this exploration.


Final safeguard measurement: `npx vitest run test/gateway/adopt-law.test.ts`
passed 36 tests in one file (exit 0). Log:
`/tmp/loam-receive-adopt-baseline.log`. This validates the existing frozen-adoption
contract identified in the rail census; it does not implement live projection.

## T281 implementation review, 2026-09-05

The first internal LIVE-only projector and two new rail files now exist. They have
no production callers or package export. An independent contract review required
explicit source-context input separation, verified duplicate handling, honest
unsupported candidates, and named resolver withholding. The implementation follows
existing lawful registration selection without a receiver signer.

The first code review found two reproducible defects in metadata inherited from
the permissive registration reader. A signed null roots payload produced an invalid
selected candidate. A signed resolver field named `__proto__` disappeared from
withholding metadata. An independent verifier reproduced both with valid signed
controls. Both were recorded in the findings ledger before repair.

Initial mutation testing killed 15 of 20 mutants. Signed malformed-envelope cases
exposed missing coverage. A supposedly equivalent payload-kind mutant also admitted
an entity target carrying an extra string value: signature verification does not
authenticate properties omitted by canonical encoding. This case requires a real
runtime guard despite the static target union. No substrate change is required.

The preliminary isolated full check passed: 328 files passed, one skipped; 3,178
tests passed, five skipped. The workspace check stopped because the pre-existing
untracked `docs/LOAM_HANDOFF.md` name violates the documentation topic grammar.
That user file remains untouched.

Final T281 checkpoint: `7a0bfc2`. The exact final source and rails passed the full
isolated check: 328 files passed, one skipped; 3,184 tests passed, five skipped.
The focused suites passed 16 tests. Scoped mutation testing killed all 20 sampled
mutants; these sample decision parsing, not exhaustive authority coverage. The
final independent re-review accepted the repairs and equivalent guard simplification.
ADLC P0, P3 and P4 assertions passed. Full P5 certification and P6 acceptance are
not claimed. No production caller or package export was added.

The raw Codex session was not valid flail-detector input: repeated prompts and
quoted source diagnostics were classified as execution failures. A normalized log
contained 52 terminal execution outcomes and all nonzero terminal output. It omitted
prompts, agent discussion and stdout from successful reads. The detector passed
that log. This is supervisor execution evidence, not a worker-edit-history audit;
the limitation and raw failure remain recorded in the manifest.

T282 now owns the next bounded proof: signed exact law manifests for one-time
imports and paused live bindings. Independent contract review identified a required
identity check: derive selected registration and definition delta IDs from the
immutable manifest operand before adding current retractions. A withdrawn pinned
definition must not fall back even to identical older content. Existing T281 rails
remain frozen; T282 first authors a separate test file.

## T282 checkpoint and external review boundary

T282 is implemented at `ee183a4`. It reuses the live projector and adds one exact
snapshot helper. Forty-four focused tests pass. The exact final isolated full check
passed 329 files with one skip: 3,212 tests passed and five skipped. Formatting,
lint, typecheck and build passed. Existing T281 and base-frozen rails remain unchanged.

Independent code review accepted the source. Independent rail review identified
four coverage gaps, which another reviewer verified before correction. Later
mutation controls distinguish malformed manifests, short source IDs, and duplicate
membership with a matching duplicate-list address. Original red measurements and
subsequent corrections remain in the ticket, findings and gate ledger.

All six deliberate semantic mutations caused assertion failures. They covered
ignored retractions, one-time imports following retractions, overbroad withdrawal,
live operands replacing snapshots, lost definition identity, and stale pauses
constraining replacement bindings. Generated helper sampling killed 19/20 mutants.
The survivor removes an early version-string check; strict computed-hash equality
still rejects those malformed values. An independent verifier confirmed equivalence
for signed JSON inputs. The guard remains. The strict hollow-test gate returned 2;
neither that gate nor T282 P3/P5/P6 completion is claimed.

ADLC's landing tier check requires a distinct-provider approval for these new rails.
Local independent reviews are complete. Automatic approval review rejected an
attempt to send private source, tests, tickets and design material to Gemini.
No payload was sent. Specific external-disclosure approval is required before retry.
The prepared payload manifest is `/tmp/loam-receiving-review-payload.json`. It lists
nine exact files and hashes; it excludes the user's handoff and credentials.

Local payload preparation also found an installation defect in adversarial-review
2.8.0: its package file list omits the root artifact prompt template. The same
template is shipped under its skill references. A temporary local tool copy restores
that exact file; the global installation remains unchanged. Local `--prompt-only`
assembly now passes. The assembled prompt is available at
`/tmp/loam-receiving-review-prompt.txt`; this preparation made no external review call.

PR #557 remains open and unmodified. Its refreshed status reports a merge conflict
and two failed platform checks. These proof commits do not retire its frozen rail
or replace its public API yet.

## Next input-construction slice

A read-only census confirmed that grants/membership (`accounts.ts`), trust
(`trust.ts`), container administration (`container.ts`), public exposure (`public.ts`),
erasure (`erase.ts`), slating (`slate.ts`) and registrations (`registration.ts` and
`lifecycle.ts`) all use operator-authored records from their supplied reactors.
Source claims sharing that signer cannot enter recipient administrative inputs.

The boot path matters as much as ingestion. Ordinary `Gateway.open` replays every
backend delta, restores registrations and preloads resolvers. Held-source storage
must not be reopened through that path. Build an explicit context from authenticated
destination administration, recipient decisions, read-only source snapshots and
destination data. Then reuse scoped binding trial and gathering with those separate
operands. Test actual standing, admission, exposure and query outcomes before and
after restart, with genuine recipient controls beside imported same-signer denials.

Preserve current root administrative inheritance and global erasure obligations;
do not widen purge reach. Source identity/incarnation and suppression closure need
precise context construction. Existing `Bound.channel` cannot serve as provenance
alone because it also chooses a different data operand. No production input adapter
has been added by either proof.


## External review authorization, 2026-09-06

Myk explicitly authorized sending the prepared repository material for external
review. He also granted standing permission for future such reviews without
repeated disclosure questions. This permission concerns code review, not unrelated
sharing. He requested Gemini 3.8 Flash where available.

Google documents `gemini-3.8-flash` as a stable model. The prepared nine-file
payload passed its recorded hash checks and was submitted using that exact model
with verification enabled. The review completed with exit 0 and a final approve verdict.


Gemini 3.8 Flash raised three initial findings and refuted all three during its
verification pass. Source deltas are verified before snapshot member lookup; live
projection does not narrow its supplied source set; live definitions intentionally
follow the lawful source revision. No source fix followed these refuted findings.
The final finding list is empty. The tool retained stale pre-verification summary
and next-step prose, so the raw result and verification log are both preserved.
This records a distinct-provider artifact review, not full P5/P6 certification.

Review result: `/tmp/loam-receiving-gemini38-review.json`. Verification transcript:
`/tmp/loam-receiving-gemini38-review.err`. Gemini 3.8 Flash is available through the
configured provider and worked for this review. Use it for subsequent Gemini review
runs unless a task warrants a different choice; the global tool default is unchanged.

## T283: competing source authors, 2026-09-06

The next P5 round found a missing test dimension. Existing foreign-signer controls
covered decisions and strikes, but no valid competing law within one source set.
A separate verifier confirmed the coverage gap, not a runtime defect. The finding
was recorded before correction. T283 owns a new separate rail; T281/T282 rails and
both runtime modules remain byte-identical.

At `328543c`, five new cases prove exact source registration, author, gather body
and resolved values. A and B publish distinguishable valid law within one source.
Live, one-time and paused selections keep the chosen author. Foreign-only exact
selections refuse under A and succeed under B. Exact manifests include foreign
definitions at A's own entities, with correct member addresses. Three deliberate
author-filter removals caused assertion failures in the new suite alone.

The next independent test lens found a second gap. Snapshot display metadata and
pinned suppression identities have independent readers. Removing author filtering
only from `definitionId` still passed all 49 tests. A separate verifier confirmed
that gap. At `11135d1`, the mixed-author cases additionally withdraw each selected
A definition, restore it, and withdraw unselected B definitions. Paused selection
becomes unavailable only for selected withdrawal; one-time selection stays fixed.
The formerly surviving mutation now fails an assertion. The independent verifier
confirmed the correction. This is an evidenced correction to the newly authored
T283 rail, preserving its earlier checkpoint and every T281/T282 rail.

The first new fixture omitted schema `alg` and failed before projection in two
cases. Adding `alg: 1` repaired the fixture before its first freeze. Do not count
that as a production failure. The final focused suite passes 49 tests. At
`328543c`, the isolated full check passed 330 files and 3,217 tests, with one file
and five tests skipped. Final exact verification after `11135d1` is recorded
separately. The sandboxed full run was stopped after required local listeners and
subprocesses failed; it is not a code-regression result or a passing check.

Evidence lives under `/tmp/loam-receiving-p5/`. `reviews.json` identifies each
reviewer and verified finding. `t283-mutations.json`, `pin-mutant-before.log` and
`pin-mutant-after.log` preserve the deliberate mutation measurements. The CI rail
guard passed all 223 inherited rails from 108 base tickets.

### Review host and attestation details

Installed prosecutor profiles prohibit exec, while this host provides no separate
file reader. Two profile attempts ended incomplete and are excluded from evidence.
Fresh reviewers then used read-only commands, with the same five distinct lenses,
sequentially. The installed plugin's prosecutor re-export also cannot resolve its
`@adlc/core` dependency. Orchestration uses the installed CLI's canonical core
helpers directly; no global package was changed.

The Gemini3.8Flash follow-up reviewed all eleven declared files and approved the
`328543c` checkpoint without findings. Its summary claimed tests passed, but the
artifact reviewer did not execute tests. Only actual execution logs support that
claim. Automatic approval review initially treated standing permission as limited
to the previous payload. It accepted the user's explicit future-review permission
on reconsideration; no additional user approval was needed.

Cross-model attestations are recorded through ADLC from an identical clean clone,
using the workspace's canonical ticket store and signed ledger. This preserves the
user's untracked handoff and avoids overriding automatic revision computation.
The actual workspace's tier check reported trust-root tier, required distinct
provider approval, satisfied=true, and a trustworthy chain at `328543c`. The
clone-only tier check was non-tiered because its committed store lacked the new
local ticket shards; it was not used as the workspace's risk proof. Subsequent
source/test changes require new revision-bound evidence.

### Final checkpoint and strict gate limitation

At `11135d1`, the exact isolated full check passes: 330 files and 3,217 tests,
with one file and five tests skipped. Formatting, lint, typecheck and build pass.
The full log is `/tmp/loam-receiving-p5/t283-check-final.log`. Runtime files and
all T281/T282 rails still match their original reviewed hashes.

Four sequential five-lens rounds completed. Rounds one and two each found one
independently verified test gap, corrected before continuing. Rounds three and
four were dry. The canonical ADLC convergence controller returned stop at two
dry rounds. Final reviewer arrays, independent verifier evidence, prompt and
reviewed artifact contents are preserved under `/tmp/loam-receiving-p5/`.

Gemini's first review of the final correction alleged that A cannot strike a
B-authored definition. Its artifact set lacked the actual authority reader.
An independent verifier executed that reader in memory and refuted the premise:
`lawfulNegated(reactor, A)` checks strike signer A, not target-author equality.
The same final files plus complete `registration.ts` went to Gemini3.8Flash.
That review refuted the allegation and approved without findings. No test was
weakened to satisfy the false finding. Final result: `gemini-authority-result.json`.

The signed distinct-provider attestations bind the final automatically computed
change identity. P5 recording passed for T281/T282/T283 using an identical clean
clone and ADLC's supported `ADLC_TICKET_STORE` override pointing to this workspace's
actual canonical store. No ticket was fabricated or staged in the clone. The
actual workspace risk check requires distinct-provider approval and is satisfied.

**Strict P5 assertion still fails.** Installed `@adlc/prosecute@1.11.0` computes
`git-change` identities through `resolveChangeSetRevision`. Installed
`@adlc/runner@1.11.0` computes `git-worktree` identities through `resolveRevision`
and compares the strings directly. The mismatch reproduces in the unchanged clean
clone, separately from this workspace's untracked files. Evidence is in
`adlc-revision-defect.json` and `assert-clean-p5-t283.err`. The recorder's
`p5-complete` entries do not override this failed integrity check. No explicit
revision was supplied, no staleness check was disabled, and no P6 or ticket
completion is claimed.

The flail detector also returned flail on normalized terminal outcomes. Its
reported signatures include quoted source lines `const errors = [];` and
`return errors;`, read from successful parts of nonzero batched commands, plus
actual missing-path reads and host errors. The raw result remains preserved as
`flail-check-result`, not a passing `flail-check`. T282's equivalent generated
mutant remains a separate strict P3 limitation. These tooling results do not
invalidate the passing tests, mutation assertions or independent review, but they
do prevent claiming full lifecycle certification.

Next work must resolve the toolkit's incompatible revision producers/readers
before strict P5/P6 acceptance. The receiving integration seam remains explicit
input construction: held source bytes stay outside recipient administration both
during ingestion and restart, then selected declarative law reads the common
eligible destination operand. No production adapter, PR557 push or merge occurred.

### Live P5 identity repair verified

T284 isolates the installation repair on `repair/adlc-phase-revisions` at
`1e6c20a` in `/tmp/loam-adlc-phase-repair`. The patch pins runner 1.11.0 source
hashes, prevalidates all targets, and shares live identity computation between
P5/P6 assertion and acceptance recording. Recorded change-set evidence requires
a caller base and separate untracked-path rejection with existing evidence
exclusions; legacy whole-worktree checks remain intact. Independent review and
Gemini 3.8 Flash both found no blocking issues. Typecheck/lint pass; targeted
integration and existing rail-enforcement tests report 28 passed, one skipped.
A TypeScript-only rail correction is recorded in T284; this is not a claim of
unchanged rail hashes or full T284 lifecycle certification.

After applying the reviewed patch, strict live P5 assertions for T281, T282 and
T283 all return exit 0 against the identical `11135d1` checkout, using
`--base origin/main`, the canonical original ticket store, and no explicit
revision. Reviewed identity remains
`git-change:62ee3e91c3f63570e58966895916a84f85a560be:8fe5bdae58aaa85638f97d94b09def6da082d1acd45a8becfe6dd2364e5cd098`.
Evidence: `/tmp/loam-adlc-phase-evidence/T28{1,2,3}-live-p5.json`,
`gemini-result.json`, and `green.log`. This supersedes the earlier revision
mismatch blocker. The separate P3 equivalent-mutant and P4 detector limitations
remain disclosed; no P6 or completion is claimed by this note.

Concrete bounded-proof acceptance packets were subsequently recorded for T281,
T282 and T283. Strict live P6 assertions also return exit 0 with the same explicit
base and unchanged reviewed identity. Packets and results are under
`/tmp/loam-adlc-phase-evidence/T28*-acceptance.md` and `T28*-run-p6.json`.
Each packet explicitly retains the independent P3/P4 limitations and excludes
production integration, ticket completion and merge from its acceptance scope.

### Physical custody prerequisite T285

Independent boundary review confirmed that raw source bytes cannot enter ordinary
Gateway boot/reseat, and borrowed storage cannot enter `openSeparate`'s owned
child/purge tree. Physical byte retention and administrative receipt delivery
currently share `erasureStandings`; a raw store has no local receipt reactor.
The proposed boundary and concrete consumer census are in
`61-receiving-input-boundary.md`.

The smallest extraction is implemented separately on `receiving/custody-probe`
(`631da58`, worktree `/tmp/loam-receiving-custody`). `probePhysicalRetention`
accepts only holds/heldAmong capabilities. `erasureStandings` consumes held and
unasked results while retaining receipt checks, rank composition and child
traversal. Purge and drop paths are untouched; no raw source attaches yet.

New tests cover actual retained MemoryBackend bytes without mutations, batch
preference and receiver binding, empty requests, partial fallback failure,
batch refusal and overreported unrelated IDs. The 48 existing erasure/drop
controls pass both before and after; with the six new cases, 54 tests pass.
Typecheck/lint pass. Independent reviewer and Gemini3.8Flash approved without
findings. A lint-only unused test parameter correction after freeze is disclosed
in T285; no strict unchanged-rail claim is made. Full repository check remains
pending at this checkpoint. Evidence: `/tmp/loam-custody-evidence/`.

Next custody slice must distinguish probe inventory from destructive authority;
merely appearing in inventory must not authorize purge/discard/drop. Existing
Gateway receipt/reseat obligations stay on Gateways. Raw stores must not receive
synthetic administrative reactors. Physical backend aliases require care:
object identity alone cannot prove distinct underlying storage.

PR557 was rechecked through GitHub: still open and conflicting on
`t263-pr10-retire-grant`. Its own contract remains the register-fence exception
and four stale reporting surfaces. No push, force update or merge occurred.

The full T285 check subsequently completed with exit 0: 331 passed files, one
skipped file, 3,223 passed tests and five skipped tests. Formatting, lint,
typecheck and build pass. This supersedes the pending-check statement above.
Current coldstart and actual review/validation results are recorded; no strict
P3/P4/P5 certification or merge is inferred from those records.

T285 subsequently completed two fresh sequential five-lens rounds, all dry.
Canonical ADLC dedupe/convergence returned stop after round two. The actual
reviewer results and reviewed source/ticket packet are preserved under
`/tmp/loam-custody-evidence`. Strict live P5 and P6 both pass against base
`11135d1` at revision
`git-change:11135d19d0e8f279dc03159bc1886e5103ece1df:759aeb4d081c7151f218cd7442c73c74f9ff2fc99863ccc8992e663248859614`.
The acceptance packet is limited to the probe extraction and explicitly retains
its P3/P4 limitations. No revision override, ticket completion, or merge occurred.

### PR557 resumption checkpoint — 2026-09-06

T279 is rebuilt locally against current remote main 62ee3e9. Candidate branch
`resume/pr557` is at 777bfc8 in `/tmp/loam-pr557-resume`. Bound registration uses
only its container prefix; operator and unbound key grants preserve their existing
behavior. CLI reporting, MCP help, registration grammar/compiled content and
spec58 now agree. The CLI still persists explicit key grants and describes why
they do not widen a binding; its unbound recipe remains intact.

The revised frozen derived-standing case is narrowly limited to the anticipated
outside-prefix rejection. Unbound controls verify primary storage, no inbox copy,
and serving to both operator and an already-connected bound reader. A separate
real CLI/SQLite test verifies persistence and truthful bound reporting.

Final npm run check passes: 3,171 tests passed, five skipped; 328 files passed,
one skipped. Formatting, lint, typecheck and build pass. An initial full-suite
failure caught removal of a still-valid unbound MCP recipe; implementation was
corrected without changing that compatibility test. Two fresh sequential
five-lens local review rounds returned no findings; canonical ADLC convergence
stops after the second dry round. Evidence and transcript are preserved under
`/tmp/loam-pr557-evidence/`.

The exact-hash frozen-rail declaration is separately prepared on
`authorize/pr557-rail` at cf0e880 in `/tmp/loam-pr557-authorization`. Candidate
contains no authorization entry. Current-main rails guard correctly fails on
that one revision; the authorization-only branch passes, and a simulation using
the proposed authorization branch as base passes. This does not establish that
authorization has landed. No push, PR update, merge or ticket completion occurred.

Automatic approval review rejected the proposed Gemini API transfer twice,
despite the user's standing authorization and requested Gemini3.8Flash model.
It requires fresh consent specific to the private payload and destination. No
PR557 external review ran. Exact files, hashes and sizes are recorded in
`/tmp/loam-pr557-evidence/pending-gemini-payload.json`: candidate diff, separate
rail declaration, and T279 frozen contract. No credentials or application data
are included. Do not retry through alternate payloads or providers to bypass
this rejection. External review and the separate base landing remain outstanding;
no full P5/P6 or current-main CI pass is claimed for PR557.

### Authorized review loop and separate base landing — 2026-09-06

Myk explicitly approved the private Gemini review packet and subsequent review
iterations. The transfer succeeded. Gemini found stale model-facing onboarding
in first-steps. Independent verification reproduced the bound prefix refusal.
The finding was recorded before correction. Commit bced794 corrects the source
and compiled topic; 22 existing server integration tests pass.

A separate post-work audit found the same obsolete promise in command help.
That finding was also recorded before correction. Commit 500ceb9 corrects grant
help and missing-prefix wording. Existing 43 CLI tests, formatting and lint pass.
The follow-up audit is clean. Gemini3.8Flash reviewed the full corrected packet
and returned approve with no findings. Actual artifacts are gemini-result.json,
gemini-recheck.json, gemini-final.json and postwork-audit.json under
/tmp/loam-pr557-evidence. The initial raw Gemini summary retained two allegations
that its own verification refuted; neither was treated as a surviving issue.

PR557 now carries 500ceb9 on its original feature branch. The prior conflicting
head is preserved remotely at archive/pr557-before-resume. Its replacement used
an exact force-with-lease; the subsequent help fix was a normal fast-forward.
The canonical T279 scope includes first-steps through the ticket service.

The separate authorization became PR560. Linux, Windows and rail checks all
passed. The reviewed five-line declaration landed separately as d4e12f4.
PR557 then passed the local rail guard against actual origin/main; no simulated
base is needed now. GitHub's original failed rail job must rerun after the
remaining platform jobs finish. No implementation merge or ticket completion
has occurred at this checkpoint. Final independent review rounds are ongoing.

### Final PR557 review and mutation hold

At500ceb9, two final independent five-lens rounds returned no findings.
Canonical ADLC convergence stops after two dry rounds. Actual Gemini approval
is signed as the distinct-provider review. Strict live P5 passes without a
revision override at:
`git-change:62ee3e91c3f63570e58966895916a84f85a560be:fd2623dbeddbbaa3e5e2cf412bec28efb15ab29f8e53affecf144ab9a9d4725a`.
Evidence: p5-live-current.json and final-transcript.txt in the PR557 evidence dir.

Final Linux and Windows CI pass. After PR560 landed, the previously failed rail
job was rerun and passed. PR557 therefore has green GitHub checks at500ceb9.

The additional required mutation gate ran in an isolated clone. The first narrow
command killed9of15mutants. Independent classification found that five survivors
already had relevant existing tests omitted from that command. The malformed
actor undefined-to-null change is REACHABLE and observable, not equivalent.
Expanded execution included register-verb, loam-docs and http tests. It killed
14of15mutants, including every generated runtime mutation and the four generated
manual corruptions. One survivor remains: the MCP description string changes
`--prefix=<ns>:` to `--prefix=<ns<=:`. The candidate's original text is correct.

No source-text pin test, compiler-error kill, gate suppression or mutation waiver
was added. The gate still returns2. Its red result is disclosed in PR557 and in
/tmp/loam-pr557-evidence/merge-decision.md. That packet presents a narrowly scoped
human decision: accept this one prose survivor for the merge, or retain the hold
while a separate tooling change is designed and reviewed. The packet does not
claim a strict P3 pass or a general future exception.

No PR557 merge, P6 acceptance, ticket completion or archive occurred. The earlier
Gemini transfer blocker is resolved and review iterations remain authorized.
The remaining intervention concerns the explicit red-gate merge policy, not
permission to run another review.

### PR557 merged — explicit exception accepted

On 2026-09-06 Myk explicitly instructed: "merge #557 with the single documented
help-text mutation exception." The acceptance packet records exactly that scope;
the mutation result remains14of15 with no strict P3 pass or general waiver.
Strict live P6 passed at the unchanged reviewed revision after acceptance.
The final head and Linux/Windows/rail checks were reverified before merging.

PR557 merged as f1cfcfcd138e138a90e0228faa531e622619b974. The squash commit
records the narrow exception and the actual review/check evidence. PR560's
separate base authorization remains its prerequisite landing. This supersedes
the previous merge hold. Acceptance evidence is in
/tmp/loam-pr557-evidence/acceptance-approved.md and p6-approved.json.
