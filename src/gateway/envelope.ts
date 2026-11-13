import type { Peer } from "./peer.js";
import type { Claims } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { EnvelopeSize } from "./leeway.js";
import type { Ground } from "./ground.js";

export const ENVELOPE_ENTITY = "loam:envelope";
export const CTX_ENVELOPE = "loam.envelope";

export const ENVELOPE_ANY = "*";

export interface QuarantineEnvelope {
  readonly maxConcurrentRenders: number;
  readonly renderTimeoutMs: number;
  readonly maxMemoryMb: number;
}

export const DEFAULT_QUARANTINE_ENVELOPE: QuarantineEnvelope = {
  maxConcurrentRenders: 4,
  renderTimeoutMs: 500,
  maxMemoryMb: 128,
};

const YOUNG_MB = 32;

const DIMENSIONS = ["maxConcurrentRenders", "renderTimeoutMs", "maxMemoryMb"] as const;
type Dimension = (typeof DIMENSIONS)[number];

export function envelopeClaims(
  subject: string,
  limits: Readonly<Record<string, number>>,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
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

export function readEnvelopePolicy(
  reactor: Ground,
  now: number,
  operator?: string,
): ReadonlyMap<string, Partial<QuarantineEnvelope>> {
  const resolved = new Map<string, Partial<QuarantineEnvelope>>();
  if (operator === undefined) return resolved;
  const negated = negatedAt(reactor, now, operator);
  const latest = new Map<
    string,
    { limits: Partial<QuarantineEnvelope>; timestamp: number; id: string }
  >();
  for (const delta of lawfulDeltasAt(
    reactor,
    now,
    { entity: ENVELOPE_ENTITY, context: CTX_ENVELOPE },
    operator,
  )) {
    if (negated(delta.id)) continue;
    const named = delta.claims.pointers.filter((p) => p.role === "subject");
    if (named.length !== 1) continue;
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

export function resolveEnvelope(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  pool?: string,
): QuarantineEnvelope {
  const policy = readEnvelopePolicy(reactor, now, operator);
  const own = pool === undefined ? undefined : policy.get(pool);
  const any = policy.get(ENVELOPE_ANY);
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

export const SIZE_ENVELOPES: Readonly<Record<EnvelopeSize, QuarantineEnvelope>> = {
  small: DEFAULT_QUARANTINE_ENVELOPE,
  medium: { maxConcurrentRenders: 8, renderTimeoutMs: 1000, maxMemoryMb: 256 },
  large: { maxConcurrentRenders: 16, renderTimeoutMs: 2000, maxMemoryMb: 512 },
};

export const workerLimitsOf = (
  env: QuarantineEnvelope,
): { maxOldMb: number; maxYoungMb: number } => {
  const maxYoungMb = Math.max(1, Math.min(YOUNG_MB, Math.floor(env.maxMemoryMb / 4)));
  return { maxOldMb: Math.max(1, env.maxMemoryMb - maxYoungMb), maxYoungMb };
};

export interface PoolEnvelope {
  readonly handle: string;
  readonly container?: string;
  resolve(): QuarantineEnvelope;
  inFlight: number;
  refusedForSlots: number;
  timedOut: number;
  faulted: number;
  malformed: number;
}

export interface EnvelopeReport {
  readonly pool: string;
  readonly container?: string;
  readonly envelope: QuarantineEnvelope;
  readonly inFlight: number;
  readonly refusedForSlots: number;
  readonly timedOut: number;
  readonly faulted: number;
  readonly malformed: number;
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

export const clampedTo =
  (inner: () => QuarantineEnvelope, outer: () => QuarantineEnvelope) => (): QuarantineEnvelope => {
    const [i, o] = [inner(), outer()];
    return {
      maxConcurrentRenders: Math.min(i.maxConcurrentRenders, o.maxConcurrentRenders),
      renderTimeoutMs: Math.min(i.renderTimeoutMs, o.renderTimeoutMs),
      maxMemoryMb: Math.min(i.maxMemoryMb, o.maxMemoryMb),
    };
  };

export function* poolsBeneath<P extends Pick<Peer, "poolHandle">>(
  gw: P,
  childrenOf: (parent: P) => Iterable<P>,
  prefix = "",
  seen = new Set<P>(),
): Generator<{ pool: P; handle: string }> {
  for (const pool of childrenOf(gw)) {
    if (seen.has(pool)) continue;
    seen.add(pool);
    const handle = pool.poolHandle ?? "?";
    yield { pool, handle: prefix + handle };
    yield* poolsBeneath(pool, childrenOf, `${prefix}${handle}/`, seen);
  }
}

export function envelopeReportsImpl(gw: Gateway): EnvelopeReport[] {
  const rows: EnvelopeReport[] = [];
  for (const { pool, handle } of poolsBeneath<Peer>(gw, (p) => p.store.pools(p))) {
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
