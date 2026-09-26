# Loam's negation readers, before step 4

Step 4 replaces Loam's negation readers with the substrate's `reactor.negationPredicate(now,
suppression)`. This file lists every reader, so that the swap is mechanical. It also lists the
defects found while reading them.

Audited tree: `main` at `b050b858`, with `@bombadil/rhizomatic` 0.11.0-next.1. Every row was read
in code.

## The three readers

- `lawfulNegated(reactor, op)` (`registration.ts:816`): a memoized closure. A negation counts when
  it is held, signed by `op` (any author when `op` is undefined), and not itself negated.
- `dataStruck(reactor, op)` (`accounts.ts:237`): one trust mask over the whole snapshot. A strike
  counts from `op` or from a subject of `op`'s surviving grants.
- `honoredStrikeOn(reactor, id, op)` (`accounts.ts`): the earliest strike on `id` that is not
  itself struck and whose author has standing (`standsFor`).

None of the three reads a negation's `validFrom` or `validUntil`.
`recordings/suppression-time.recording.test.ts` pins that.

## Call sites

Pre-filter: **LS** is `lawfulSnapshot`. **LDA** is `lawfulDeltasAt`. **snap+auth** is the full
snapshot with an inline author check. **snap** has no author filter. **byTarget** is the target
index. **one id** is a single named id.

| # | site | question | trust | pre-filter |
| --- | --- | --- | --- | --- |
| 1 | `translate.ts:164` `readTranslations` | translation spec struck | operator | LS |
| 2 | `translate.ts:289` `translate` | source delta struck as data | `dataStruck` | snap |
| 3 | `receive-policy.ts:133` `projectLiveReceiving` | receiver withdrew a decision | receiver key | snap+auth |
| 4 | `local-channel-events.ts:239` `localChannelsInContainer` | pool declaration struck | operator | one id |
| 5 | `receive-snapshot.ts:104` `selectReceivingSnapshot` | source withdrew pinned law | source key | one id |
| 6 | `public.ts:79` `readPublicSchemas` | public declaration struck | operator | LDA |
| 7 | `budget.ts:128` `readBudgetPolicy` | budget declaration struck | operator | LDA |
| 8 | `trust.ts:118` `readTrustPolicyAt` | trust declaration struck | operator | LDA |
| 9 | `slate.ts:622` `readSlates` | slate record retracted | operator | LS |
| 10 | `slate.ts:1611` `findGraveyard` | graveyard record struck | operator | LS |
| 11 | `slate.ts:1640` `readGraveyards` | graveyard record struck | operator | LS |
| 12 | `slate.ts:1737` `graveyardCompleteness` | member's erasure struck | operator | LS |
| 13 | `slate.ts:1848` `deriveReceiptImpl` | as 12, for the receipt | operator | LS |
| 14 | `artifact.ts:128` `readArtifactRoutes` | artifact route struck | operator | LDA |
| 15 | `channel.ts:513` `readChannels` | channel record struck | operator | snap+auth |
| 16 | `channel.ts:2312` `dropChannelCommit` | channel record already struck | operator | snap+auth |
| 17 | `channel.ts:2657` `curseChannelLawImpl` | pool binding already struck | operator, pool reactor | snap |
| 18 | `channel.ts:2743` `cursesOf` | curse lifted | operator | snap+auth |
| 19 | `erase.ts:371` `boundErasures` | erasure struck | operator | byTarget |
| 20 | `erase.ts:927` `liveOpening` | pool declaration stands | operator | one id |
| 21 | `binding-policy.ts:108` `readBindingPolicy` | binding policy struck | operator | LDA |
| 22 | `container.ts:553` `computeContainerTable` | container record struck | operator | LS |
| 23 | `container.ts:800` `currentContainerDeclarationId` | container declaration struck | operator | LDA |
| 24 | `container.ts:815` `survivingDeclarationIds` | container declaration struck | operator | LDA |
| 25 | `container.ts:2273` `unreachableStoreReport` | which declarations are struck | operator | LS |
| 26 | `adopt.ts:139` `readAdoptions` | author withdrew an adoption record | own author | snap |
| 27 | `adopt.ts:234` `promoteImpl` | source output struck | `dataStruck` (pool) | one id |
| 28 | `adopt.ts:235` `promoteImpl` | author's retraction still stands | own author | one id |
| 29 | `adopt.ts:338` `promoteImpl` | adopted delta struck here | `dataStruck` | one id |
| 30 | `adopt-law.ts:825` `readLawAdoptions` | law adoption struck | operator | snap+auth |
| 31 | `attention.ts:112` `latestByKey` | quiet or looked marker struck | operator | byTarget |
| 32 | `envelope.ts:161` `readEnvelopePolicy` | envelope declaration struck | operator | LDA |
| 33 | `renderers.ts:298` `readRenderers` | renderer binding struck | operator | LS |
| 34 | `renderers.ts:395` `readPoolRenderers` | pool renderer binding struck | operator, pool reactor | LS |
| 35 | `renderers.ts:420` `readForeignRenderers` | shipper withdrew a renderer | own author | snap |
| 36 | `runner.ts:136` `readBindingDefinitions` | runner binding struck | operator | snap |
| 37 | `registration.ts:943` `survivingCandidates` | registration withdrawn | operator | LS |
| 38 | `cli.ts:3547` `groundGrants` | which strike revoked a grant | `honoredStrikeOn` | byTarget |

## Classes

- **A. Operator strike on a constitutional record.** Rows 1, 4, 6–25, 30–34, 36 and 37. Replace
  with a predicate whose suppression is "author is the operator". When the operator is undefined,
  rows 1, 15, 21, 33, 36 and 37 count every author. Rows 6, 7, 8, 9, 11, 14, 19, 22, 23 and 32
  return early instead. Keep both behaviours.
- **B. A fixed author's own withdrawal.** Rows 3, 5, 26, 28 and 35. Replace with "author is K",
  where K is the receiver, the source, or the record's own author.
- **C. Data strike.** Rows 2, 27 and 29. The suppression is the operator plus the subjects of
  surviving grants. Each build is one mask over the whole snapshot.
- **D. Strike provenance.** Row 38. It needs which strike holds and when, under `standsFor`. The
  boolean predicate does not answer this. It needs the witness form, or it keeps its own walk.

## Defects found

Each is CONFIRMED in code. None is fixed here.

1. A memo outlives a store change. Row 16 keeps its predicate across `await gw.append(...)`. Row 13
   keeps it across awaits in a loop.
2. `strikeOf` (`slate.ts:1766`) decides "negated" with `lawfulNegated`, then reports the first
   operator strike from raw `negationsOf`. That strike may itself be struck. An erasure receipt can
   then name a strike that does not hold.
3. Row 17 walks a pool reactor with no author filter on the bindings. Any author's registration in
   the pool becomes a curse target. Only the operator's strikes count.
4. Row 31: a looked marker is accepted from several authors, but only the operator can strike it.
   A non-operator author cannot withdraw a marker of their own.
5. Row 25 keeps the struck declarations on purpose. A refactor must keep this polarity.
6. Row 28 uses two trust inputs in one expression. The retraction test is scoped to the source
   author, and the struck test to the grantees.
7. Row 38 lists grants from every author, with no author filter. `inertStrike` (`cli.ts:3558`)
   reads raw `negationsOf`.
8. Rows 26 and 35 keep one memo per author. Peers choose the authors, so the number of memos has
   no bound.
