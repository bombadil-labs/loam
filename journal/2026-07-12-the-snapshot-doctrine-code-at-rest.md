## 2026-07-12 — The snapshot doctrine: code at rest resolved before its design stage opened

Myk asked how code lives as deltas when the deltas are context-free — no "track changes." The
answer that held: neither does git. Blobs are whole snapshots; every diff anyone has ever read
was computed at read time from two snapshots and a lineage relation. The missing feature was the
design all along. So the doctrine, now recorded as a DECIDED cross-cutting block in TODO.md
(landing with §22, cited by §21/§23/§24): **deltas assert versions of coherent wholes plus
supersession claims; diff is a lens** — and so is the AST: structure WITHIN a unit is derived
from the bytes, structure BETWEEN units (import graphs, outlines) lives in deltas. **The
granularity of a delta is the granularity of attestation — what would an author sign?** — because
the signature must attest exactly the bytes that run; a swarm of signed fragments carries no
signature on the combination a reader manufactures from them, which is where AST-level deltas
die (they manufacture interleavings nobody wrote, tested, or meant — the §24 trust story
dissolving on contact). Ordering is an authored claim at the container level, so concurrent
arrangements CONFLICT visibly (§13) rather than interleave silently. Economics climb inline →
content-addressed ref → Merkle-chunked tree without ever leaving snapshot semantics; content
addressing dedups unchanged units across versions, which is most of what diffs ever bought. If
live collaborative editing ever comes, it is an ephemeral layer that ASSERTS snapshots;
keystrokes are not claims.

Myk's fold: this is §21's picture wearing different clothes — a living Schema reified into a
fixed, content-addressed VersionedSchema is the same doctrine arriving at versioning. Resolutions
threaded through TODO.md: §22 question 4 RESOLVED (residue: source vs built artifact, settled in
the transcription); §23's "what a renderer delta IS" resolved by inheritance; §21 question 2
narrowed to WHERE the snapshot lives (the doctrine favors a distinct snapshot entity — prove it);
§24 gains its footing (the thing on probation is a fixed, attested artifact).

Learning: when a substrate seems to lack a feature the incumbents have, check whether the
incumbent stores it or derives it — git's object model is a context-free, content-addressed
store, and "track changes" lives entirely at read time. The lack was the design.
