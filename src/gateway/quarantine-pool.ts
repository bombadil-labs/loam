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
import { MemoryBackend } from "../store/memory.js";
import { isRepairable } from "../store/quarantine.js";
import { isTombstone, readTombstones } from "./erase.js";
import { withNegationClosure } from "./ingest.js";
import { Gateway, type FederationReport } from "./gateway.js";

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
  // attach a store it cannot prove clean. (The at-rest detach RECORD waits for T32's mint.)
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

// Open a QUARANTINE POOL over a store (the body of `Gateway.openQuarantine`, SPEC §24 — a thin delegating
// method on the class, its body here beside the pool's own vocabulary, ticket T19): a second gateway on
// its OWN backend, seeded ONE-WAY from the primary by federation, sharing THE PRIMARY's operator (§24.1 —
// the pool is the operator's own staging store, so the operator's erasure stays authoritative there,
// §24.8; the one sanctioned shared-seed case). The edge is inbound only — nothing is ever wired back, so
// a pool write can never reach the primary. The operator's seeded law binds in the pool (it resolves a
// real, living lens over the real ground); foreign law stays inert until promoted. Drop the pool and the
// primary is untouched (discard = erase-by-construction).
export async function openQuarantineImpl(
  gw: Gateway,
  opts: QuarantineOptions = {},
): Promise<QuarantinePool> {
  if (gw.options.seed === undefined) {
    throw new Error("only an operated store can open a quarantine pool (§24.1)");
  }
  const backend: StoreBackend = opts.backend ?? new MemoryBackend();
  // SETTLE ERASURE DEBT BEFORE THE POOL EXISTS (T72). A durable store being (re)opened as a pool
  // may hold bytes whose tombstones landed at the primary while it was detached — the seeding
  // edge DELIVERS a tombstone as data and executes nothing, so attaching first would boot a
  // reader that resolves the forgotten byte LIVE while the tombstone sits beside it in its own
  // ground. The primary's surviving tombstones are authoritative here (the pool shares its
  // operator), so the debt is swept at the bytes NOW — before any reactor replays the store —
  // and a store that cannot be proven clean of it refuses to attach at all (H9: unproven bytes
  // do not come back inside the walls).
  const dead = [...readTombstones(gw.reactor, gw.operatorAuthor)];
  if (dead.length > 0) {
    let owed: Set<string>;
    try {
      if (backend.heldAmong) {
        owed = await backend.heldAmong(dead);
      } else {
        owed = new Set<string>();
        for (const id of dead) if (await backend.holds(id)) owed.add(id);
      }
      if (owed.size > 0) {
        await backend.purge([...owed]);
        for (const id of owed) {
          if (await backend.holds(id)) {
            throw new Error(`the store still holds ${id} after the settling purge`);
          }
        }
      }
    } catch (err) {
      throw new Error(
        `openQuarantine refused: this store carries erasure debt that could not be settled — ` +
          `bytes the operator ordered forgotten must not come back inside the walls as a live ` +
          `reader. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  const pool = await Gateway.open(backend, { seed: gw.options.seed });
  // A membership filter narrows what the pool SEES, never what it must FORGET (§24.8): the
  // operator's tombstones pass the seeding edge unconditionally, exactly as `eraseReplica`
  // delivers them live — a quarantine inherits the holes along with the ground. (A forged
  // tombstone slipping this wrapper is still refused inside federate by eraseDefect; the
  // authorization gate is unchanged.)
  if (opts.admit !== undefined && opts.membership !== undefined) {
    throw new Error(
      "openQuarantine: give a membership Term OR an admit predicate, not both — admit is the " +
        "degenerate form of the same knob (§24.10)",
    );
  }
  // A membership Term is proven at the door (parse + dset-sort, via the same select the reading
  // surface serves) and re-evaluated on every pulse — the scope is LIVE, like the ground it cuts.
  if (opts.membership !== undefined) gw.select(opts.membership);
  const base = opts.admit;
  const memberAdmit = (): ((d: Delta) => boolean) | undefined => {
    if (opts.membership === undefined) return base === undefined ? undefined : base;
    // The members are the Term's dset PLUS its negation closure (§28.4, T38). A scope may narrow
    // what the pool sees; it may never resurrect what was struck, and `negated` ranging over the
    // operand set means a claim admitted without its retraction reads as live inside. `select()`
    // itself stays exactly the Term's dset — the closure belongs to this edge, not to the reading
    // surface a caller asks "what does this Term select".
    const members = new Set(withNegationClosure(gw, gw.select(opts.membership)).map((d) => d.id));
    return (d) => members.has(d.id);
  };
  const reseed = (): Promise<FederationReport> => {
    const admit = memberAdmit();
    return pool.federate(
      gw.offeredDeltas(),
      // A scope narrows what the pool SEES, never what it must FORGET (§24.8): the operator's
      // tombstones pass the seeding edge unconditionally, membership and predicate alike.
      admit === undefined ? {} : { admit: (d) => isTombstone(d.claims) || admit(d) },
    );
  };
  await reseed(); // one-way INBOUND seeding; the reverse leg is never wired
  // Bind the operator's federated schemas so the pool RESOLVES the seeded ground — the dry-run reads a
  // living lens, not raw deltas. (Foreign, non-operator law federated in binds nothing until promoted.)
  pool.replayRegistrations();
  await pool.preloadResolvers();
  gw.quarantinePools.add(pool);
  return {
    gateway: pool,
    reseed,
    // Drop DISCARDS — at the bytes, on every backend (T72). The old body detached and closed,
    // which "discarded" only the default MemoryBackend; a durable pool's seeded copies survived
    // on disk, outside every future erasure's reach (erase walks only ATTACHED pools) — the
    // evasion channel §24.8 exists to prevent, opened by the cleanup call. So: purge everything,
    // then VERIFY at the bytes (holds — a purge's count is evidence, never the verdict, T70),
    // and on any survivor REFUSE while leaving the pool attached: a store that cannot prove
    // discard stays inside the erasure fan-out rather than slipping out of it.
    drop: async () => {
      const refuse = (why: string, cause?: unknown): never => {
        throw new Error(
          `drop refused: ${why} — a dropped pool must not become bytes outside the erasure ` +
            `fan-out. The pool remains ATTACHED (still in erasure reach); resolve the store ` +
            `fault and drop again, or detach() to keep it deliberately.`,
          cause === undefined ? undefined : { cause },
        );
      };
      try {
        // The dead set is everything this pool can NAME — and a read alone cannot name it all
        // (the erasure lens's finding): a mirror's `deltasSince` is primary-only, and a RETRY
        // after a partial purge reads EMPTY, which made the old zero-ids path skip the verdict
        // entirely and report success over a retaining tier. The session reactor remembers what
        // the read cannot, so the enumeration is their union; and the §25 quarantine pen — rows
        // a read SET ASIDE as corrupt, still legible bytes on disk — is swept by its own door,
        // since no id-keyed purge can reach a row whose id was never returned.
        const ids = new Set((await pool.backend.deltasSince(new Set())).map((d) => d.id));
        for (const d of pool.reactor.snapshot()) ids.add(d.id);
        if (isRepairable(pool.backend)) {
          for (const row of await pool.backend.quarantine()) {
            await pool.backend.discardRow(row.key);
          }
        }
        if (ids.size > 0) {
          const batch = [...ids];
          await pool.backend.purge(batch);
          // The verdict, H9-closed: a probe that cannot answer has proven nothing, so a
          // rejecting store refuses the drop exactly like a retaining one.
          let survivors: Set<string>;
          if (pool.backend.heldAmong) {
            survivors = await pool.backend.heldAmong(batch);
          } else {
            survivors = new Set<string>();
            for (const id of batch) if (await pool.backend.holds(id)) survivors.add(id);
          }
          if (survivors.size > 0) {
            refuse(
              `this pool's store still holds ${survivors.size} of ${batch.length} delta(s) ` +
                `after the discard purge`,
            );
          }
        }
        // What no read and no session ever named is outside drop's jurisdiction — a straggler
        // bearing an unlisted id is heal's domain (§11), stated rather than implied clean.
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("drop refused:")) throw err;
        refuse(
          `this pool's store could not be proven clean (${
            err instanceof Error ? err.message : String(err)
          })`,
          err,
        );
      }
      gw.quarantinePools.delete(pool);
      await pool.close();
    },
    // Detach KEEPS — the deliberate act, distinct in name from the discard. No purge, no
    // verification: the caller is choosing to hold these bytes outside the fan-out (debugging a
    // suspect pool), and reattachment is openQuarantine over the surviving store.
    detach: async () => {
      gw.quarantinePools.delete(pool);
      await pool.close();
    },
  };
}
