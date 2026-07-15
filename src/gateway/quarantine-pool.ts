// A QUARANTINE POOL (SPEC §24) — a place where untrusted law may bind. A second Gateway over its OWN
// store, seeded ONE-WAY from a primary by federation, where remote-authored schemas / resolvers / renderers
// may actually RUN — bind, resolve, render, WRITE — while everything they produce is sequestered in this
// pool, never the primary's canonical ground. Dry-run a stranger's whole app against your real ground, then
// DROP the pool (discard = erase-by-construction) or PROMOTE what you like (a later §24 slice; the only door
// out). This is §24.1's separate-store posture and §24.2's one-way glass, made concrete.
//
// NAMING: distinct from `src/store/quarantine.ts`, which is §25's ROW-CORRUPTION holding pen (a different
// word for a different mechanism — unreadable bytes set aside for repair, not a federation sandbox).
//
// SAME OPERATOR, by design (§24.1 / §24.8). The pool shares the primary's operator seed: it is the
// operator's OWN staging store, so the operator's ERASURE stays authoritative here — a tombstone that fans
// in passes `eraseDefect` and the forgotten byte is purged from the pool too, so §11 reaches through the
// glass unconditionally and the pool can never become an erasure-evasion channel. This is the ONE sanctioned
// shared-operator-seed case; §8's "distinct operator seeds across instances" rule guards mutually-distrustful
// EXTERNAL peers, not the operator's own quarantine (which is one trust domain with the primary). Foreign
// (non-operator) law federated into the pool stays inert-by-default (§8/§12) until an operator promotion.

import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../store/backend.js";
import type { FederationReport, Gateway } from "./gateway.js";

// A live quarantine pool (returned by `Gateway.openQuarantine`). `gateway` is the pool's own gateway — its
// own backend, the operator's seed, seeded one-way from the primary. `reseed` re-pulses the one-way inbound
// edge (the primary's ground is live: a fresh pull sees new facts and, crucially, new tombstones). `drop`
// detaches the pool from the primary's erasure fan-out, closes it, and discards its store wholesale.
export interface QuarantinePool {
  readonly gateway: Gateway;
  reseed(): Promise<FederationReport>;
  drop(): Promise<void>;
}

export interface QuarantineOptions {
  // The store the pool lives in. Defaults to a fresh in-memory backend, so drop == discard (nothing on
  // disk to reclaim); pass a durable backend for a long-running quarantine.
  readonly backend?: StoreBackend;
  // A selective inbound-seeding filter (§24.2): which of the primary's offered deltas the pool admits. The
  // narrowing knob that EXISTS today (there are no read-side capability slices, §7) — the operator hand-picks
  // what the quarantine SEES by filtering at the edge, rather than what a piece of code may see once in.
  readonly admit?: (d: Delta) => boolean;
}
