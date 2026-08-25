// The QUARANTINE RESOURCE ENVELOPE (SPEC §24.5) — the operator's second undelegatable power.
//
// Under container-scoped trust an operator hands a child container almost everything: a child may
// admit deltas its parent does not trust. Exactly two powers do not delegate. The operator can still
// FORGET — erasure fans out through the glass unconditionally (§24.8, built) — and the operator can
// still CAP THE BILL. Take the second away and delegated admission becomes an unbounded bill on
// someone else's say-so, which is why an envelope is not a performance knob. It is what makes hosting
// a stranger's pool a thing an operator can afford to say yes to.
//
// The shape follows `budget.ts` (SPEC §25): configuration is DATA. One operator-authored declaration
// at `loam:envelope` names a pool and the ceilings on the workers it may run, re-resolved from the
// live deltas on every render — so widening a pool is a delta, not a restart. Malformed declarations
// are refused at the APPEND door; federation has no door (`federate` skips `authorize`), so the
// reader below re-validates every dimension rather than trusting that the door saw it, and drops what
// it cannot read. Door and reader agree because BOTH check, not because one vouches for the other.
//
// TWO DELIBERATE DIVERGENCES from budget.ts, both load-bearing:
//
//  1. THE DECLARATION IS READ FROM THE PARENT, never from the pool. A pool's resolver is closed over
//     the PARENT's reactor. A child that may admit what its parent distrusts must never be able to
//     admit a delta that raises its own ceiling; if the ceiling lived on the child's ground, it could.
//  2. NO DECLARATION MEANS THE DEFAULT, not "unmetered". An author with no budget is unmetered
//     because they are the operator's own grantee. An unmetered quarantine is exactly the unbounded
//     bill this file exists to close, so the built-in envelope is the floor everyone starts from.
//
// HONEST SCOPE, and it changed. This file is still the RESOURCE half only — slots, a wall clock, a
// memory ceiling. The REACH half is no longer open: §24.5's standing flag ("a worker can still reach
// `node:fs` or open a socket") was closed by T172, and a pool's renders now run in a confined realm with
// no filesystem, no network and no process authority (`render-worker.ts`). The two halves compose here
// rather than replacing one another — a pool's declared clock and memory ceiling govern its ADMISSIONS
// as well as its renders, so a stranger's module body is billed to the pool that hosts it.
//
// What is still NOT bounded by either half: CPU inside the realm past the clock (`terminate()` is the
// answer, and it is the timeout's), and §22 resolvers, which are not confined at all (`esm.ts`).

import type { Claims, Reactor } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { lawfulDeltasAt, lawfulNegated } from "./registration.js";

export const ENVELOPE_ENTITY = "loam:envelope";
export const CTX_ENVELOPE = "loam.envelope";

// The subject every pool falls back to: one declaration an operator can write once to govern every
// quarantine on this store, including the anonymous ones, which have no entity to name.
export const ENVELOPE_ANY = "*";

// The ceilings in force for one pool. EXTENSIBLE BY ADDITION, never by migration: a future dimension
// (an outbound-effect budget, a byte ceiling) is a new field here and a new pointer role on the wire,
// so an old store tolerates and ignores a dimension it does not recognize while enforcing the ones it
// does.
export interface QuarantineEnvelope {
  readonly maxConcurrentRenders: number; // slots: how many of this pool's renders may run at once
  readonly renderTimeoutMs: number; // the pool's own wall clock, per render
  readonly maxMemoryMb: number; // per-worker heap ceiling, old + young together
}

// The floor a pool starts from with no declaration at all. Deliberately TIGHTER than the primary's
// anonymous render fan (§23.9's `maxPublicRenders`, default 16): a quarantine is a staging area, and
// nothing in this file widens what an unconfigured store already allowed.
export const DEFAULT_QUARANTINE_ENVELOPE: QuarantineEnvelope = {
  maxConcurrentRenders: 4,
  renderTimeoutMs: 500,
  maxMemoryMb: 128,
};

// The largest scavenger a pool is ever handed — §23.9's own constant, and the cap on the share the
// split below gives the young generation.
const YOUNG_MB = 32;

const DIMENSIONS = ["maxConcurrentRenders", "renderTimeoutMs", "maxMemoryMb"] as const;
type Dimension = (typeof DIMENSIONS)[number];

// One declaration: the pool it meters (its declared container entity, or `*` for every pool that has
// no declaration of its own) and one or more limit dimensions. Operator-signed; a fresh declaration
// for the same subject supersedes by timestamp.
export function envelopeClaims(
  subject: string,
  limits: Readonly<Record<string, number>>,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: ENVELOPE_ENTITY, context: CTX_ENVELOPE } },
      },
      { role: "subject", target: { kind: "primitive", value: subject } },
      ...Object.entries(limits).map(([role, value]) => ({
        role,
        target: { kind: "primitive" as const, value },
      })),
    ],
  };
}

// Is this delta an envelope declaration, and if so, is it WELL-FORMED law? Exactly one string
// subject, at least one dimension, and every dimension THIS store recognizes a positive integer. A
// dimension it does not recognize is a newer store's limit — tolerated, never rejected. Zero is
// refused rather than read as "closed": a pool that may run nothing is a mistake in a declaration,
// and dropping the pool is how an operator says that.
export function envelopeDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ENVELOPE_ENTITY &&
      p.target.entity.context === CTX_ENVELOPE,
  );
  if (!declares) return undefined;
  const subjects = claims.pointers.filter((p) => p.role === "subject");
  if (
    subjects.length !== 1 ||
    subjects[0]!.target.kind !== "primitive" ||
    typeof subjects[0]!.target.value !== "string" ||
    subjects[0]!.target.value === ""
  ) {
    return "an envelope declaration names exactly one pool subject";
  }
  const dimensions = claims.pointers.filter((p) => p.role !== "declares" && p.role !== "subject");
  if (dimensions.length === 0) {
    return `an envelope declaration carries at least one limit (${DIMENSIONS.join(", ")})`;
  }
  for (const dim of DIMENSIONS) {
    const held = claims.pointers.filter((p) => p.role === dim);
    if (held.length > 1) return `an envelope declaration carries at most one ${dim}`;
    if (held.length === 0) continue;
    const value = held[0]!.target.kind === "primitive" ? held[0]!.target.value : undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return `${dim} must be a positive integer`;
    }
  }
  return undefined;
}

// The per-pool ceilings the operator declared, by subject. Governed stores only; the latest surviving
// LAWFUL declaration per subject wins (timestamp, id as tiebreak). Mirrors readBudgetPolicy —
// including its lawful-voice discipline: in a governed store a federated stranger cannot meter
// someone else's pool, nor widen their own.
export function readEnvelopePolicy(
  reactor: Reactor,
  operator?: string,
): ReadonlyMap<string, Partial<QuarantineEnvelope>> {
  const resolved = new Map<string, Partial<QuarantineEnvelope>>();
  if (operator === undefined) return resolved;
  const negated = lawfulNegated(reactor, operator);
  const latest = new Map<
    string,
    { limits: Partial<QuarantineEnvelope>; timestamp: number; id: string }
  >();
  for (const delta of lawfulDeltasAt(
    reactor,
    { entity: ENVELOPE_ENTITY, context: CTX_ENVELOPE },
    operator,
  )) {
    if (negated(delta.id)) continue;
    // Exactly one subject, as the door requires — not the last of several. A delta that means two
    // things binds neither; taking the last would have the reader honor a shape the door refuses.
    const named = delta.claims.pointers.filter((p) => p.role === "subject");
    if (named.length !== 1) continue;
    // And at most one pointer per DIMENSION, as the door also requires. Taking the last of several
    // would let the ORDER of a delta's pointers pick the ceiling, and last-wins is the widening
    // direction — a federated declaration carrying `maxConcurrentRenders: 1, maxConcurrentRenders:
    // 64` would meter at 64 on a path that never met a door.
    if (DIMENSIONS.some((d) => delta.claims.pointers.filter((p) => p.role === d).length > 1)) {
      continue;
    }
    let subject: string | undefined;
    const limits: { -readonly [K in Dimension]?: number } = {};
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string" && p.target.value !== "") {
        subject = p.target.value;
      }
      if (
        (DIMENSIONS as readonly string[]).includes(p.role) &&
        typeof p.target.value === "number" &&
        Number.isInteger(p.target.value) &&
        p.target.value >= 1
      ) {
        limits[p.role as Dimension] = p.target.value;
      }
    }
    if (subject === undefined) continue;
    const current = latest.get(subject);
    if (
      current === undefined ||
      delta.claims.timestamp > current.timestamp ||
      (delta.claims.timestamp === current.timestamp && delta.id > current.id)
    ) {
      latest.set(subject, { limits, timestamp: delta.claims.timestamp, id: delta.id });
    }
  }
  for (const [subject, { limits }] of latest) resolved.set(subject, limits);
  return resolved;
}

// The envelope in force for one pool, resolved PER DIMENSION: the pool's own subject wins, else the
// wildcard, else the built-in floor. Per dimension rather than wholesale, so a per-pool declaration
// that names only the clock cannot silently reset the wildcard's slot count to the built-in default —
// the tightening an operator writes must not widen something else behind their back.
export function resolveEnvelope(
  reactor: Reactor,
  operator: string | undefined,
  pool?: string,
): QuarantineEnvelope {
  const policy = readEnvelopePolicy(reactor, operator);
  const own = pool === undefined ? undefined : policy.get(pool);
  const any = policy.get(ENVELOPE_ANY);
  // A per-pool declaration THIS STORE CAN READ NOTHING FROM — every dimension it names belongs to a
  // newer store — takes the TIGHTER of the floor and the wildcard, per dimension. `readBudgetPolicy`
  // drops such a subject, which for a quota means unmetered; for a CEILING the conservative reading
  // is the tightest one available. Falling through to the wildcard alone would answer an operator's
  // unreadable tightening with a widening; falling to the floor alone would do the same wherever the
  // operator's wildcard is TIGHTER than the floor, which is the case a store under pressure is in.
  // NOTE the interaction with wholesale supersession: an unreadable declaration replaces this
  // subject's earlier readable one, so a prior per-pool tightening is lost rather than kept. That is
  // supersession behaving as declared, and it is bounded above by the floor — but it means the
  // tightest available reading is the tightest BASELINE, not the tightest thing ever declared here.
  const unreadable = own !== undefined && DIMENSIONS.every((d) => own[d] === undefined);
  const pick = (dim: Dimension): number => {
    const floor = DEFAULT_QUARANTINE_ENVELOPE[dim];
    if (unreadable) return Math.min(floor, any?.[dim] ?? floor);
    return own?.[dim] ?? any?.[dim] ?? floor;
  };
  return {
    maxConcurrentRenders: pick("maxConcurrentRenders"),
    renderTimeoutMs: pick("renderTimeoutMs"),
    maxMemoryMb: pick("maxMemoryMb"),
  };
}

// The `resourceLimits` an envelope hands the Worker (§23.9's constructor). `maxMemoryMb` is the
// pool's WHOLE heap, so the two generations SPLIT it rather than each taking it: V8 sizes old and
// young independently and the process may hold both at once, so handing 32 to each permits ~64 while
// the report prints 32 — a ceiling an operator lowers to contain a leak, that does not bound what it
// names (H7). The young generation takes a quarter, capped at §23.9's constant so a roomy pool is not
// handed an enormous scavenger, and floored at 1 so a 1MB declaration still starts a worker.
export const workerLimitsOf = (
  env: QuarantineEnvelope,
): { maxOldMb: number; maxYoungMb: number } => {
  const maxYoungMb = Math.max(1, Math.min(YOUNG_MB, Math.floor(env.maxMemoryMb / 4)));
  return { maxOldMb: Math.max(1, env.maxMemoryMb - maxYoungMb), maxYoungMb };
};

// A pool's LIVE accounting: the resolver (closed over the parent's reactor — see divergence 1 above)
// plus the counters an operator reads. The object belongs to the pool's gateway, which is what makes
// two pools unable to borrow each other's budget and what makes a drop release the envelope: the
// counters die with the pool rather than living in a registry that outlives it.
export interface PoolEnvelope {
  // The display handle: the declared container entity, or `anonymous#N` for a pool with none.
  readonly handle: string;
  // The declared container entity, absent for an anonymous pool. THE ONLY STRING THAT IS A VALID
  // SUBJECT — kept separate from the handle on purpose. A synthetic handle printed where a subject
  // goes would invite an operator to declare an envelope for `anonymous#1`, which the door would
  // accept and which would bind nothing: a success reported over a no-op (H7). It would also share a
  // namespace with real container names, since a container may lawfully be called `anonymous#1`.
  readonly container?: string;
  resolve(): QuarantineEnvelope;
  inFlight: number;
  refusedForSlots: number;
  timedOut: number;
  faulted: number;
  malformed: number;
}

// What the operator reads: one row per live pool, naming WHICH pool hit WHICH limit. The refusal a
// caller meets stays leak-free (§17); this is the other half of "exhaustion is loud" — loud toward
// the operator, silent toward the stranger.
export interface EnvelopeReport {
  readonly pool: string; // the handle; a nested pool reads `outer/inner`
  readonly container?: string; // the declared entity — absent means "no subject can name this pool"
  readonly envelope: QuarantineEnvelope;
  readonly inFlight: number;
  readonly refusedForSlots: number;
  readonly timedOut: number; // the pool's clock fired
  // Three causes share this bucket: the bundle threw, the worker died (the memory ceiling shows
  // here), or the host never started the thread (§23.9's spawn ceiling). None of them is the
  // pool's clock firing on a render, which is what `timedOut` alone must mean.
  readonly faulted: number;
  readonly malformed: number; // the bundle returned something that is not HTML
}

export function newPoolEnvelope(
  handle: string,
  container: string | undefined,
  resolve: () => QuarantineEnvelope,
): PoolEnvelope {
  return {
    handle,
    ...(container === undefined ? {} : { container }),
    resolve,
    inFlight: 0,
    refusedForSlots: 0,
    timedOut: 0,
    faulted: 0,
    malformed: 0,
  };
}

// A child pool's ceilings, CLAMPED by its opener's. A pool may itself open a pool, and the inner one
// resolves against the outer one's ground — which is untrusted ground. Unclamped, an untrusted
// container could hand its own child more of the host than the operator gave it, which is precisely
// the delegation this whole file refuses. Nothing below the operator can widen; it can only tighten.
export const clampedTo =
  (inner: () => QuarantineEnvelope, outer: () => QuarantineEnvelope) => (): QuarantineEnvelope => {
    const [i, o] = [inner(), outer()];
    return {
      maxConcurrentRenders: Math.min(i.maxConcurrentRenders, o.maxConcurrentRenders),
      renderTimeoutMs: Math.min(i.renderTimeoutMs, o.renderTimeoutMs),
      maxMemoryMb: Math.min(i.maxMemoryMb, o.maxMemoryMb),
    };
  };

// THE ONE TRAVERSAL of the runtime container tree: `quarantinePools`, the canonical registry of
// attachment, walked recursively because a pool may open a pool. Two consumers on purpose — the
// §24.5 envelope report and drop()'s discard fan-out (container.ts) — so they cannot drift: a
// second hand-rolled walk is a second registry, and two registries disagree in exactly the
// direction that costs bytes — a pool the report bills but no discard reaches (T162). Every
// separate container carries a handle, enveloped or not, so a pool nested under a CURATED
// container is still attributable; an unnamed prefix would collide across two such containers and
// read two pools as one. `seen` guards a cycle the attach rules already forbid.
export function* poolsBeneath(
  gw: Gateway,
  prefix = "",
  seen = new Set<Gateway>(),
): Generator<{ pool: Gateway; handle: string }> {
  for (const pool of gw.quarantinePools) {
    if (seen.has(pool)) continue;
    seen.add(pool);
    const handle = pool.poolHandle ?? "?";
    yield { pool, handle: prefix + handle };
    yield* poolsBeneath(pool, `${prefix}${handle}/`, seen);
  }
}

// The rows for every enveloped pool in this store's reach — one consumer of `poolsBeneath`. A
// depth-1 report would hide a nested pool's whole bill while the operator's erasure still reached
// it. A separate container that is not untrusted carries no envelope and is absent by construction.
export function envelopeReportsImpl(gw: Gateway): EnvelopeReport[] {
  const rows: EnvelopeReport[] = [];
  for (const { pool, handle } of poolsBeneath(gw)) {
    const env = pool.envelope;
    if (env === undefined) continue;
    rows.push({
      pool: handle,
      ...(env.container === undefined ? {} : { container: env.container }),
      envelope: env.resolve(),
      inFlight: env.inFlight,
      refusedForSlots: env.refusedForSlots,
      timedOut: env.timedOut,
      faulted: env.faulted,
      malformed: env.malformed,
    });
  }
  return rows;
}
