# Law, vocabulary, schemas, resolvers and code-in-deltas: where Loam builds around rhizomatic

I audited `/home/mykola/bombadil-labs/loam-refactor` at `a9276e96` without changing anything. It uses `@bombadil/rhizomatic` 0.8.0 from `node_modules`. The central finding: nearly every "law" reader in Loam is a hand-written host loop, and each loop keeps only the deltas signed by the operator's key. The substrate has no way to express "the deltas whose meaning a given key governs".

## Entries

**1. Law means "signed by the operator", and a host filter decides it**
- **Loam does:** `lawfulSnapshot` (`registration.ts:796`) and `lawfulDeltasAt` (`registration.ts:872`) drop every delta whose author is not the operator. Registrations, trust, public, budget, artifact, envelope, binding policy, tombstones, renderers, containers and translations all read through them. `operatorAuthor` is not read from the ground: it comes from the seed passed to the gateway (`gateway.ts:461`). `loadHyperSchema(lawfulSnapshot(...))` shows the same pattern at `adopt-law.ts:1055`.
- **Substrate gap:** SPEC-3 §5 says competing definitions are "resolved by the same policies as any data (trusted authors)". SPEC-3 §6 says an evolvable ref resolves "under the evaluator's … resolution schema". But `loadHyperSchema(dset, entity)` and `loadSchema` take no trust or policy argument, and they hard-code "latest surviving" (`dist/schema-deltas.js:56-65`). SPEC-6 §3 "claim trust" has no read path for definitions.
- **vNext candidate:** a "governed read" primitive. One option is `loadHyperSchema/loadSchema(dset, entity, {trust: Pred | Schema})`. Another is a blessed stdlib term, `select(author∈K) ∘ mask(trust author∈K)`, per the SPEC-5 §8 standard-library question.
- **Class:** rhizomatic contract. **Tier:** schema, with principal supplying K. **Confidence:** CONFIRMED.

**2. Four hand-written negation algebras**
- **Loam does:**
  - `lawfulNegated` (`registration.ts:815`): only the operator's strikes count, walked recursively in the host.
  - `dataStruck` (`accounts.ts:231`): a real `mask{trust}` term built from `lawfulStrikersJson` (`accounts.ts:175`).
  - `struck` / `standsFor` (`accounts.ts:316`, `333`): a recursive walk of the grant chain.
  - `survivalOver` (`adopt-law.ts:257`): a strike counts only if the striker is the target's own author.
- **Substrate gap:** SPEC-2 §4 `mask(trust(p))` tests the negating delta alone. "The striker equals the target's author" cannot be expressed. The reactor also has no indexed query for "negated under a Pred". That is why `lawfulNegated` exists instead of a mask: a mask evaluation reads the whole store on every request (H8).
- **vNext candidate:** a relative trust form for mask (for example `trust: selfOnly`), plus a reactor index `negatedUnder(id, pred)`.
- **Class:** rhizomatic contract. **Tier:** algebra and reactor. **Confidence:** CONFIRMED.

**3. Well-known `loam:*` anchors collapse into one entity when stores are unioned**
- **Loam does:** constitutional law is filed at fixed ids: `genesis.ts:36`, `trust.ts:24`, `public.ts:18`, `erase.ts:57`, `slate.ts:75`, `budget.ts:32`, and others. Readers tell stores apart only through the operator filter (entry 1). `repair.ts:44-60` warns when a non-operator delta targets a `loam:` id. The `LawAt` comment (`registration.ts:861-866`) records that the fail-direction differs by reader when the candidate list is empty: trust and budget admit, public and artifact refuse. An ungoverned store has no filter, so its anchors truly merge.
- **Substrate gap:** NOTE-12 §3(b) proposes key-scoped minting for ids that travel. NOTE-12 §3(c) says string equality across a boundary is not co-reference. Neither is normative.
- **vNext candidate:** anchors derived from the governing key (for example `loam:trust@<key>`). Alternatively, the principal tier states "peer P is governed by key K", and readers take K from the ground rather than from process configuration.
- **Class:** decision for Myk. **Tier:** principal. **Confidence:** CONFIRMED.

**4. "Law resolves like data" (spec/47) is still host code**
- **Loam does:**
  - `interpretBindingPolicy` (`binding-policy.ts:171`) and `survivingCandidates` (`registration.ts:931`) sort by (timestamp, id) and implement `byTimestamp`, `byAuthorRank` and `conflicts`.
  - `readTrustPolicyAt` (`trust.ts:111`) takes the latest mode plus the union of roster entries.
  - `readPublicSchemas` takes a union; `readBudgetPolicy` takes the latest value per subject.
- **Substrate gap:** these are SPEC-5 §3 Policies (`pick byTimestamp desc`, `all`, `chain([byAuthorRank([op]), byTimestamp])`), but they are written as loops. Loam's `conflicts` also has different semantics from SPEC-5's: Loam withholds the name and lists every contender.
- **vNext candidate:** each law anchor becomes a HyperSchema resolved by a Schema in the resolve tier. The host keeps only shape validation (`trustDefect`, `bindingPolicyDefect`). Loam's withhold-on-conflict behaviour stays Loam policy.
- **Class:** Loam policy, executed through the resolve tier. **Tier:** resolve. **Confidence:** CONFIRMED.

**5. Resolvers ship arbitrary code inside the binding and run it at read time (spec/22)**
- **Loam does:** a resolver's ESM rides the registration delta, is loaded from a `data:` URL and runs synchronously after the Policy (`resolvers.ts:1-21`, `loadResolver`, `applyResolvers:286`). `candidateValue` (`resolvers.ts:105`) is a hand copy of rhizomatic's value extraction (SPEC-5 §2.1). The memo key carries the negated flag and the child readings.
- **Substrate gap:** SPEC-5 §3 says arbitrary reducers cannot ship inside schema terms; computed resolution belongs to derived authors. SPEC-0 P4 says "terms, never code". SPEC-7 §7 says JS closures are not portable identity.
- **vNext candidate (per the ruling):** a resolve-tier library with a post-Policy pure hook. It would share the WASM ABI with derivation (`07-derivation-abi.PROPOSAL.md`), export `candidateValue`, and own the memo-key contract.
- **Class:** rhizomatic contract. **Tier:** resolve, with the derivation ABI. **Confidence:** CONFIRMED.

**6. Derived-author definitions use a Loam vocabulary with a free-string function id**
- **Loam does:** `loam.binding` definition deltas (`runner.ts:20`, `readBindingDefinitions:122`). `fnId` is an arbitrary string looked up in `implementations: Record<string, DerivedFn>`. Latest-per-name and lawful-negation logic is written by hand.
- **Substrate gap:** SPEC-7 §3 says bindings are deltas under `rhizomatic.derived.*`. SPEC-7 §2 identifies a function by the `fnHash` of its artifact. `DerivationHost` writes only `derived.binds`: `BindingSpec` has no readable definition vocabulary and no `fnHash`.
- **vNext candidate:** the derivation tier owns the binding-definition vocabulary and content-addressed artifacts.
- **Class:** rhizomatic contract. **Tier:** derivation. **Confidence:** CONFIRMED.

**7. A lens has no substrate identity, which is the root of H6**
- **Loam does:**
  - A registration pairs a HyperSchema entity with a living `schema:<name>` and a snapshot `schema:<name>@<hash>` under `loam.registration` (`registration.ts:504-545`).
  - `lensOf` and `programOf` brand types exist to turn H6 into a type error (`registration.ts:334-362`).
  - `lensNameOf` recovers the lens name by stripping the `schema:` prefix from an entity id (`registration.ts:1070`).
  - `genesis.ts` re-derives the name itself.
- **Substrate gap:** rhizomatic knows a "reading" only inside `expand` (SPEC-5 §4). There is no named (HyperSchema, Schema) binding. CLAUDE.md already says "Lens is prose".
- **vNext candidate:** a lens binding (name → HyperSchema pin + Schema pin) with vectors. Roots, mutations, writable, refs and resolvers stay Loam's.
- **Class:** decision for Myk (does a rhizomatic spec fix this meaning?). **Tier:** schema. **Confidence:** CONFIRMED.

**8. The Schema version hash is computed twice, and a "frozen" snapshot is a named entity**
- **Loam does:** `versionedSchemaHash` is `contentAddress(schemaCanonicalHex)` (`registration.ts:529`). The resolver memo uses rhizomatic's `schemaHash` instead (`resolvers.ts:128`), which encodes `jsonToCbor(schemaToJson(...))` (`dist/term-io.js:257`). The snapshot is loaded through `loadSchema`, which takes the latest surviving definition. It stays frozen only because nothing but the operator writes there.
- **Substrate gap:** SPEC-3 §6 defines `{pinned: hash}` for HyperSchemas only. There is no pinned-Schema registry.
- **vNext candidate:** one Schema hash function, and pinned Schema refs that resolve by hash.
- **Class:** rhizomatic contract. **Tier:** schema. **Confidence:** the duplication is CONFIRMED; whether the two hashes are byte-identical is PLAUSIBLE.

**9. Adopting another store's law re-signs it in the operator's voice**
- **Loam does:** the blessing re-speaks the source law under operator authorship with the source's timestamp, because only operator-authored law binds (H4). `supersede` puts a `negates` pointer on a substantive delta, which the file header says is the first such case in the codebase, and which leaks through narrowing closures (`adopt-law.ts:1-45`). `loam.adoption` provenance lives in its own vocabulary (`adopt.ts:16-60`).
- **Substrate gap:** SPEC-6 §6 says received definitions are claims, not installations, and are weighed by claim trust.
- **vNext candidate:** if entry 1's governed read accepts a ranked key set or a pin set, a blessing becomes "admit this pin". It no longer needs a re-signed copy.
- **Class:** decision for Myk. **Tier:** federation or schema. **Confidence:** CONFIRMED.

**10. The boundary between law and data is a string prefix**
- **Loam does:** `RESERVED_ID_PREFIX="loam:"` and `RESERVED_CTX_PREFIX="loam."` (`repair.ts:34-35`). `promotionRefusal` checks roles and contexts for the `loam.` and `rhizomatic.` prefixes and ids for `loam:` (`adopt.ts:68-94`). `adopt-law.ts` hard-codes `"rhizomatic.hyperschema.defines"` and `"rhizomatic.schema.defines"` (around lines 86-87) instead of calling rhizomatic's exported `definitionRoles()`.
- **Substrate gap:** namespace governance is open in SPEC-3 §9, and SPEC-5 §6 only reserves `rhizomatic.*`.
- **vNext candidate:** a rhizomatic `isReservedVocabulary` predicate that also covers `schema.*`. The `loam.*` part is Loam's.
- **Class:** Loam policy, with a small rhizomatic contract. **Tier:** schema. **Confidence:** CONFIRMED.

**11. Loam proves facts about terms by evaluating them on sample data**
- **Loam does:**
  - `assertMaterializable` evaluates the body on an empty set at root `loam:trial` to learn its sort (`lifecycle.ts:121`).
  - `assertTemplatesVisible` builds specimen deltas to prove the gather can see a write template (`lifecycle.ts:74`).
  - `edgeRoles`, `readinglessExpandRole` and `referenceProps` walk term JSON by hand (`registration.ts:45`, `150`, `218`).
- **Substrate gap:** no `sortOf(term)`, and no "shapes a body consumes" function. SPEC-9 §5 relation signatures are close to the second.
- **vNext candidate:** `sortOf` and `consumedShapes(body)`, giving the spec/51 adjoint and oriented slots (SPEC-9 §2).
- **Class:** rhizomatic contract, low priority. **Tier:** algebra. **Confidence:** CONFIRMED.

**12. The stock shelf and gather idioms are a de-facto standard library**
- **Loam does:** `entityGatherJson` and `entityGatherBody` (`gather.ts:50`, `67`). `governedGatherBody` (`accounts.ts:215`) is a Loam-parameterised variant.
- **Substrate gap:** SPEC-5 §8 asks for blessed, pinned schemas, but none exist yet.
- **vNext candidate:** ship the canonical entity gather as a rhizomatic stdlib pin. The shelf entries stay Loam's.
- **Class:** decision for Myk. **Tier:** schema. **Confidence:** CONFIRMED.

## Anchors

Readers disambiguate one way everywhere: in a governed store they keep only operator-authored deltas at the anchor, then apply `lawfulNegated`. An ungoverned store keeps everything.

| Anchor / context | What it collects | Reader behaviour on a unioned or ungoverned store |
|---|---|---|
| `loam:store` / `loam.operator`, `loam.grants` | Operator marker (timestamp 0), grants | Grants are checked by the `standsFor` chain from the configured operator. The marker is never used to find the operator. |
| `loam:trust` / `loam.trust` | Trust mode and admitted authors | Latest mode, union of roster. Ungoverned or empty means **open**. |
| `loam:public` / `loam.public` | Lens names readable without a token | Union of names. Ungoverned or empty means nothing is public. |
| `loam:erasure` / `loam.erasure`, `.slate`, `.graveyard` | Tombstones, slates, graveyards | Only operator tombstones bind. Ungoverned means erasure is **never** honoured. |
| `loam:budget` | Per-subject quotas | Latest per subject. Empty means unmetered. |
| `loam:envelope` | Pool worker ceilings | Operator filter plus lawful negation. |
| `loam:artifact` | Publication routes | Union. Empty means refuse. |
| `loam:binding-policy` | Contest mode | Latest surviving. Undeclared keeps the legacy behaviour. |
| `loam:manifest` | Module export rows | Filtered by `author === operator` (`channel.ts:1091`). |
| `loam:adoption` | Promotion provenance | Filtered by author and `isAdoption` (`adopt.ts:144`). |
| Named anchors: `hyperschema:<N>`, `schema:<n>`, `registration:…`, `binding:<n>`, `pen:<n>`, container ids | Law definitions | `lawfulSnapshot`. Two stores' `hyperschema:Film` merge, and only the operator filter separates them. |

## Recording targets

These are pure or nearly pure decision functions whose outputs are worth recording over fixed corpora.

- **`interpretBindingPolicy`** (`binding-policy.ts:171`). Input: a candidate list, a mode and an operator. It is already fully pure.
- **`readTrustPolicyAt`, `readPublicSchemas`, `readBudgetPolicy`, `readBindingPolicy`, `readTombstones`**. Input: a delta corpus with foreign-author and struck or unstruck declarations, plus an operator, with and without a governing operator. Record the empty-list fail direction explicitly.
- **`lawfulNegated`, `survivalOver`, `dataStruck`, `honoredStrikeOn`** (`accounts.ts`). Input: strike and counter-strike chains with mixed authors. Record all four side by side to pin down how they differ.
- **`survivingCandidates`, `readRegistrations`, `readRegistrationVersions`, `readWithdrawnRegistrations`**. Input: sibling lenses over one program, struck and republished bindings, a lens name that differs from the program name (the H6 fixture).
- **`bucketOf`, `candidateValue`, `memoKey`** (`resolvers.ts`). Input: HViews with expansions, `annotate` or `drop` masks, symmetric edges.
- **`versionedSchemaHash` against rhizomatic `schemaHash`**. Input: a Schema corpus. This settles entry 8.
- **`promotionRefusal`, `legibilityWarnings`, `trustDefect`, `bindingPolicyDefect`, `parseRegistrationInput`, `parseResolvers`, `parseRefs`, `referenceProps`, `readinglessExpandRole`**. Input: claim and JSON corpora.
- **`readBindingDefinitions`** (`runner.ts:122`). Input: definitions with malformed emit, superseded and struck cases. Record the malformed and superseded sinks.
