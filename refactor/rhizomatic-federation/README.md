# rhizomatic-federation (L6)

The layer-6 library: what peers must agree on when deltas cross a boundary. It depends on
`@bombadil/rhizomatic` for L1 to L5, and for the `Peer` and sync that L6 already has.

Planned parts, in ladder order (see `../README.md`):

1. **Trust.** Grants, membership, rosters and trust policy. From `src/gateway/accounts.ts` and
   `src/gateway/trust.ts`.
2. **Admission.** The validation chain at the append door: `authorize` in
   `src/gateway/accounts.ts`, and the defect checks it calls.
3. **Subscriptions and scopes.** Channels and containers, against rhizomatic SPEC-6 §4 and
   NOTE-11.
4. **Law across peers.** Registration, versioning, adoption and manifests.
5. **Forgetting.** Tombstones, slates, graveyards and receipts, against SPEC-6 §7.

Each part ships three things: spec text, a TypeScript implementation and vectors.

Empty until M2.
