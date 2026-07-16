## 2026-07-15 — §23.7 byte-door + bytes-in-views, v1 build: a face made of bytes

The first of the four coldstart-clean §23 build tickets (T9–T12) authored by yesterday's design passes.
A renderer paints pixels; some pixels ARE bytes — an avatar, a font. rhizomatic 0.5.0's `View` can be a
`BytesView` ({ mime, value: Uint8Array }), and a schema that gathers a `bytes` Target resolves a field to
one — but Loam's serializers passed a View through as JSON, and raw bytes are not JSON. This slice closes
that latent seam to the settled §23.7 contract.

One shared helper (`src/gateway/bytes.ts`) does the whole job, reused by every consumer: `bytesEnvelope`
deep-walks a view and replaces each bytes leaf with the self-describing `{ mime, ref, base64url? }`
envelope; `findBytesByRef` walks it for the door's lookup; `INLINE_MAX = 512` is the one tunable const.
`ref` is `contentAddress` over the RAW bytes — equal to rhizomatic's bytes-target identity, so the ref a
consumer reads equals the ref the door looks up (asserted in a test); `base64url` is rhizomatic's unpadded
url-safe encoding, present only when the value inlines. The envelope is applied at EVERY view→JSON seam —
the gql `ViewValue` scalar (so every field and `_view`, and by inheritance subscriptions + MCP, which ride
the same scalars), the REST `nodeBody`, and — the one call the ticket's letter didn't name but its village
DoD required — the renderer host itself: `serveRoute` now hands the renderer the enveloped view, so a
bundle paints `<img src="/:mount/bytes/${n.view.avatar.ref}?from=…">` without ever meeting a `Uint8Array`.
`ResolverOutputType` gains `bytes` (§22.6) so a field is ADVERTISED as bytes — gql `BytesValue`, OpenAPI
`format: binary`; the value-level envelope and the type-level advertising are the two independent knowings
§23.7 names.

The byte-door — `GET /:mount/bytes/<ref>?from=<lens>/<entity>` (`Gateway.serveBytes`, wired on both doors)
— is PROOF-OF-READ, not a ref→bytes oracle: it re-resolves the named lens+entity under this door's own
discipline (public → a declared lens only, exactly `surface('public')`) and serves the bytes only if that
live view actually contains a `BytesView` whose content address is `ref`. Every miss collapses to a UNIFORM
404, so a stranger learns nothing, and the re-resolution IS the lookup — no store scan. §11 erasure then
falls out for free: the door never caches, so a purged source delta drops from the live view and the ref
404s by construction (proven by a test AND the village act).

Two decisions worth recording. (1) The renderer is a view consumer like gql/REST, so it should see the
same envelope — enveloping the render input is safe (primitives pass through unchanged, so every existing
renderer is unaffected) and it is what makes a bytes-bearing renderer possible at all; without it a bundle
has no ref to point an `<img>` at. This widened `RenderNode.view` to `Record<string, unknown>` (a bytes
leaf is now an envelope, not a raw `BytesView`). (2) The full-door byte-door reuses `surface('full')`
exactly as `serveRoute` and GraphQL do, so it opens no read path the mount doesn't already grant — the
mount stays the read boundary (§7); per-field read capabilities remain the unbuilt work §24 flags.

Learning: "apply the envelope at both serialization points" (the ticket's letter) was one seam short of the
ticket's own village DoD — the renderer host is a third view consumer, and the img-src requirement only
closes if it sees the envelope too. The green bar isn't the ticket's prose; it's the behavior, and the
village act is what caught the gap (an `<img>` can't reference bytes the renderer can't name). The sweep for
missed seams (the ticket's trap #1) is the real work of a bytes-in-views change — I grepped every `.view`→
JSON site (gql scalars, REST body, SSE, MCP, the renderer host) and confirmed each routes through the one
envelope helper.

`npm run check` green — 581 tests (test/gateway/bytes.test.ts 11: envelope threshold + ref equality +
idempotence + nesting, the door's proof-of-read + uniform 404 + erasure-by-construction + the two-door
discipline, and the bytes-typed field advertised at gql/OpenAPI; test/server/byte-door-http.test.ts 4: the
door over real HTTP, GET-only, the anonymous door on a declared lens). Village act
`demos/village/phase-bytes.mjs` (A FACE MADE OF BYTES, 3/3) exercises it end to end over HTTP. Additive/
non-breaking (a store with no bytes is unchanged) → no §20 migration. Executable/read-surface change → not
self-merged despite the ticket being `build`-category; opened for Myk's merge (P6). Capability-security
self-review folded in (the door reuses serveRoute's discipline; no new read path); the fs/net ocap of
executable consumers stays the named §23.9/§24 work.
