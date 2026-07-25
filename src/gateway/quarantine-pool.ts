// A QUARANTINE POOL (SPEC §24) — a place where untrusted law may bind. A second Gateway over its OWN
// store, seeded ONE-WAY from a primary by federation, where remote-authored schemas / resolvers / renderers
// may actually RUN — bind, resolve, render, WRITE — while everything they produce is sequestered in this
// pool, never the primary's canonical ground. Dry-run a stranger's whole app against your real ground, then
// DROP the pool (discard = erase-by-construction) or PROMOTE what you like (a later §24 slice; the only door
// out). This is §24.1's separate-store posture and §24.2's one-way glass, made concrete.
//
// SINCE T32 the pool is ONE PRESET of the container primitive (SPEC §27, container.ts):
// UNTRUSTED · separate · one-way-seeded · droppable. `openQuarantine` keeps its exact signature and
// behavior — the settle-before-boot ordering, the drop-verify, the refusal prefixes — and its
// body is `openContainerImpl` with the knobs preset and the preset's own refusal voice. An
// anonymous pool has no container entity to cite, so it detaches RECORDLESS — stated by the spec
// rather than discovered; a NAMED container lands the at-rest detach record (container.ts).
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
import { openContainerImpl } from "./container.js";
import type { FederationReport, Gateway } from "./gateway.js";

// A live quarantine pool (returned by `Gateway.openQuarantine`). `gateway` is the pool's own gateway — its
// own backend, the operator's seed, seeded one-way from the primary. `reseed` re-pulses the one-way inbound
// edge (the primary's ground is live: a fresh pull sees new facts and, crucially, new tombstones). `drop`
// DISCARDS: purges everything the pool can name (readable surface + session memory + the §25 pen),
// verifies at the bytes, and only then detaches and closes — refusing, still attached, when it cannot
// prove the discard. A straggler bearing an id no read ever named is heal's domain, not drop's.
export interface QuarantinePool {
  readonly gateway: Gateway;
  reseed(): Promise<FederationReport>;
  drop(): Promise<void>;
  // The deliberate KEEP (Myk, 2026-07-24): close WITHOUT purging — detach a suspect pool to debug
  // it, then reattach by opening a pool over the surviving store. Until then the bytes are outside
  // the fan-out: that is the point, and the caller's named responsibility. Reattachment restores
  // reach going FORWARD and settles the debt of the window — openQuarantine sweeps any id the
  // primary tombstoned while the store was away, before the pool's reader exists, refusing to
  // attach a store it cannot prove clean. (An anonymous pool detaches recordless; the at-rest
  // record is a NAMED container's, SPEC §27.)
  detach(): Promise<void>;
}

export interface QuarantineOptions {
  // The store the pool lives in. Defaults to a fresh in-memory backend, so drop == discard (nothing on
  // disk to reclaim); pass a durable backend for a long-running quarantine.
  readonly backend?: StoreBackend;
  // A selective inbound-seeding filter (§24.2): which of the primary's offered deltas the pool admits. The
  // narrowing knob that EXISTS today (there are no read-side capability slices, §7) — the operator hand-picks
  // what the quarantine SEES by filtering at the edge, rather than what a piece of code may see once in.
  readonly admit?: (d: Delta) => boolean;
  // The same knob, GENERALIZED (§24.10 / §27.6, ticket T15): a MEMBERSHIP TERM — the JSON `op`
  // profile of a rhizomatic Term selecting a delta set over the primary's ground. The pool is
  // seeded with exactly the members, re-evaluated on every pulse, so the composed set algebra
  // (difference/intersect, nested to any depth — Term-layer ONLY, never inside `inView`) scopes
  // what a quarantine sees. `admit` is this knob's degenerate predicate form; give one or the
  // other, never both.
  readonly membership?: unknown;
}

// Open a QUARANTINE POOL over a store (the body of `Gateway.openQuarantine`, SPEC §24): the
// untrusted-and-separate preset of the container primitive, anonymous — no declaration, no at-rest
// record, the preset's own refusal voice byte-for-byte. Everything §24 promises (the one-way
// glass, the settle, §24.8's fan-out membership, drop's byte-verified discard) is the SEPARATE
// posture's behavior in container.ts, unchanged by the lifting — that invariance is T32's criterion 1.
export async function openQuarantineImpl(
  gw: Gateway,
  opts: QuarantineOptions = {},
): Promise<QuarantinePool> {
  const c = await openContainerImpl(
    gw,
    { ...opts, trust: "untrusted", posture: "separate" },
    "openQuarantine",
  );
  return {
    gateway: c.gateway!,
    reseed: () => c.reseed(),
    drop: () => c.drop(),
    detach: () => c.detach(),
  };
}
