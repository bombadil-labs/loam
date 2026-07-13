## 4. The object model & flow

`deltas —[Hyperschema: gather]→ Hyperview —[Schema: resolve]→ View`. Two stages, kept separate: one
`HView` backs many resolutions; one schema runs over many hyperviews.

- **Selector** — the root/scope of a resolution: **static** (an id/list) or **dynamic** (a sub-query
  evaluated at execution — late-binding; composes; may be clock-effectful, but a snapshot pins the
  resolved scope deterministically).
- **View — static vs dynamic.** `query` returns a **snapshot** (a resolved, content-addressed,
  immutable value — a commit). `subscribe` returns a **dynamic view** (a live materialization — a
  branch — an initial snapshot + a patch stream `old-hash → new-hash + diff`), samplable to a
  snapshot at any instant. Every resolution product (Hyperview or View) is either live (maintained +
  subscribable) or pinned (a snapshot); sampling crosses live → pinned.
- **Two reads** — `query → View` (the resolved value) and a gather read `→ Hyperview` (the scoped
  deltas = the receipts). Functions consume one or the other by declaration (value-functions take a
  `View`; superposition functions take a `HView`).
- The raw **scan** is ground truth; a hyperschema is a named, cacheable, structured scan; a snapshot
  memoizes it.

**Provenance.** Landed — the two-stage gather/resolve split rides the gateway's own verbs: [#4](https://github.com/bombadil-labs/loam/pull/4) (`query` → snapshot **View**) and [#5](https://github.com/bombadil-labs/loam/pull/5) (`subscribe` → live **dynamic view**, patch stream). Lives in `src/gateway/gateway.ts` (`Gateway.query`, `Gateway.subscribe`, the `Channel` patch stream) atop rhizomatic's `resolveView` and reactor materializations (§2). One `HView` really does back many resolutions in the code — gather and resolve stay two honestly separate steps all the way to the wire.
