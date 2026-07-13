## 15. The browser peer — a full store in the page

§12 gave the page a CLIENT — keys minted and claims signed in the browser, a served store's door
on the other end. This section gives the page the STORE. A complete Loam — gateway, genesis,
law, lenses, erasure, trust, federation — boots in a tab, persists in localStorage, and needs no
server anywhere. It is not a lite mode and there is no fork: §8 already made "where the deltas
sleep" a driver's business, so the browser peer is the same `Gateway` on a different driver. It
is born governed, answers GraphQL, honors tombstones, resolves its trust policy live, and can
pull the network. What it cannot be is a place the network calls — stated proudly below.

- **The surface — `@bombadil/loam/browser`, a curated barrel.** The root barrel (`src/index.ts`)
  re-exports `serve`, sqlite, the archive, and the CLI, so a browser entry must CHOOSE, not
  filter. It exports: the whole `Gateway` (boot / query / subscribe / append / federate /
  publishRegistration / erase), `assembleGenesis` + `operatorMarkerClaims`, `MemoryBackend` +
  **`LocalStorageBackend`** + the `StoreBackend` type, the claim constructors (`grantClaims`,
  `membershipClaims`, `revocationClaims`, `trustClaims`, `publicClaims`, `eraseClaims`,
  `registrationClaims`, `translationClaims`), the readers (`readRegistrations`,
  `readTrustPolicy`, `readTombstones`, `holdsGrant`), federation (`pullFrom`, `toWire` /
  `fromWire`), the `Runner` (an animate tab is a deploy choice too, §6), `mintSeed` /
  `authorForSeed` — and the substrate primitives the surface is SPOKEN in: `parseTerm`,
  `parseSchema`, `signClaims` (learned building it: without these a page could hold a schema
  but never say one — the claim constructors return unsigned claims, and `assembleGenesis` /
  `publishRegistration` take terms and schemas the page must be able to parse from JSON).
  Deliberately absent: `serve` (there is no port), `SqliteBackend` /
  `ArchiveBackend` / `MirrorBackend` (there is no fs), the CLI. Shipped exactly as `./client`
  is — a second esbuild entry (`src/browser/index.ts` → `dist/browser/index.js`), platform
  browser, the same `node:http` stub alias, one self-contained ESM file — pinned by the same
  discipline: zero `node:` specifiers, and the bundle must BOOT (genesis → register → claim →
  query, all inside the artifact). `graphql` rides along (pure JS); the bundle is store-sized,
  not client-sized — said plainly, not hidden.

- **`LocalStorageBackend` — one key per delta.** Key `loam:<store>:<id>`, value the delta's
  canonical wire JSON. Chosen over a single blob because the seam chose it first: per-delta keys
  make append O(batch) not O(store), make purge a `removeItem`, and make two handles on one
  origin converge to the union by construction — a blob is last-writer-wins, which is data loss
  wearing simplicity's clothes. (And in devtools the store reads as what it is: content-addressed
  facts, one per row, the id in the key — the pedagogy is free.) Write-through, no snapshot tier:
  localStorage is synchronous, so durability is the same instant as acceptance. Reads recompute
  every id and verify every signature — a row edited in devtools is corruption, refused, exactly
  as a tampered sqlite row is. Quota is this disk's edge: a `QuotaExceededError` mid-batch removes
  the keys the batch already wrote, then rejects the whole batch — atomic, as the seam demands —
  and the gateway latches its existing degradation ("this gateway can no longer persist"): reads
  keep answering, writes refuse loudly, and the remedy is export (below) or a bigger driver.
  IndexedDB is a later drop-in behind the same seam — capacity is a driver's property, never a
  semantic change.

- **The seed lives at its own key** (`loam:<store>:seed`), never under the delta prefix — so no
  export of deltas can carry key material by accident, structurally. Custody in the same register
  as §5's server-seed note: the key is page-resident, and anything that can run script on the
  origin — XSS, a hostile extension, a shared machine — can sign as this store's operator. A
  browser store's law is exactly as trustworthy as the page holding its pen. For a tutorial store
  that is fine, and said so; for anything more, keep the operator seed in the user's own custody
  and let the page be a granted author (§7), or a §12 client of a served store.

- **One writing tab.** localStorage is shared per-origin, and per-delta keys keep the STORAGE
  convergent (union by id — the same guarantee two sqlite handles keep), but a gateway reads its
  backend once at boot and holds no live view of another writer (§8's stated posture). So: one
  writing gateway per store; a second tab sees the union at its next boot; cross-tab liveness is
  federation's job, not a driver's improvisation with storage events.

- **Federation posture, honestly.** A browser store can PULL — `pullFrom` in a tab is an
  aggregator with a URL bar (CORS on public mounts already serves this) — and can PUSH — sign
  locally, `POST /append` at a served peer, the author-standing rule unchanged. It cannot BE
  PULLED: a browser cannot listen, so no peer can ask it `deltasSince`. A browser store is a leaf
  or an aggregator, never a hub. The compensations are already in the architecture: push what
  matters to a served peer (which CAN be pulled — the relay pattern), or export. Two stores in
  ONE page need no HTTP at all — federation is a direct `local.federate(other.offeredDeltas())`
  call; the HTTP pull was only ever the transport. Deltas never belonged to stores (§13); a tab
  closed forever orphans nothing anyone copied.

- **Erasure reaches the page.** Tombstone → `purge` → `removeItem`: the bytes leave the origin's
  storage, and the door refuses the id's return, same law as everywhere (§11). Per-instance as
  ever — erasing here says nothing about copies already pushed or exported. And the browser's own
  "clear site data" is an unceremonious full erasure — deltas, tombstones, and seed alike — which
  is exactly why export exists.

- **Continuity — the store walks out of the browser.** An export is a frozen federation offer:
  `{ deltas: WireDelta[] }`, byte-identical to a `GET /federate` body, ids and signatures intact —
  so migration never launders provenance (§13's rebirth pattern, verbatim). Landing it is one
  command, one door, two sources: **`loam pull <url|file>`** — a live peer or a frozen offer, both
  through `Gateway.federate` (trust-admission; no standing needed; tombstones still bar the door).
  Then the fork, and the operator decides it:
  - **Same operator** — `loam init --seed <hex>` with the browser's seed, then `loam pull
    export.json`. Genesis is pure, so the CLI store IS the browser store — the operator marker is
    the same delta by content address — and every registration, grant, trust claim, and tombstone
    in the export is operator-authored here too, so THE LAW BINDS on arrival. A store born in a
    tab, served from a laptop; nothing re-signed, nothing lost.
  - **Foreign operator** — the deltas cross (union is union) and the testimony is all there; the
    law stays inert, exactly as §5/§7/§14 promise: foreign registrations reshape nothing, foreign
    grants gate nothing, foreign tombstones erase nothing. Re-register your own lenses over the
    imported ground, translate its dialect if it differs (§8), reassert what you endorse (§13).
    Data federates; authority never does.

- **Boundaries, in the §13 register:** no listener — we did not smuggle WebRTC into a footnote;
  ~5 MB and one origin — quota and same-origin policy are this deployment's walls, and the seam is
  the door out; key custody is page custody; timestamps come from a clock the user owns
  (testimony, §13 — only more so); erasure-in-a-tab erases one replica.

**Provenance.** Landed — [#51](https://github.com/bombadil-labs/loam/pull/51) (the browser store: `LocalStorageBackend` + the `@bombadil/loam/browser` barrel), [#52](https://github.com/bombadil-labs/loam/pull/52) (aftermath hardening), [#53](https://github.com/bombadil-labs/loam/pull/53) (continuity: `loam pull`, export). Lives in `src/browser/index.ts` and `src/store/local-storage.ts`. Learning that stuck: a raw NUL byte in `gateway/erase.ts`'s commitment preimage had made the file grep-invisible, hiding a `node:crypto` import that blocked the whole gateway from bundling — the byte became its escape sequence, and the fix is the reason the law bundles clean today.
