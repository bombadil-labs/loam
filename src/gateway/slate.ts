// The SLATE and the GRAVEYARD (SPEC §29, ticket T64) — erasure in TWO PHASES, with a visible
// intermediate state. Identification SLATES a frozen set of deltas and CLOSES some of three doors
// over them; the cut then performs §11's ordinary erasure per member, lands a graveyard, and drops
// the slate's container as its last act. `drop()` is the last act of the cut, never the cut: a
// property container holds no bytes of its own, so striking its declaration purges nothing.
//
// A slate is NOT a new primitive. It is a T32 property container (the membership) plus one record
// at `loam.erasure.slate` (who asked, when, the deadline, which doors honour it). The join is a
// POINTER: what makes a container a slate is a surviving lawful record pointing at it, never a name
// convention — a prefix code parses becomes law by accident (the H6 register).
//
// A separate-store slate is refused at the door, and the refusal is load-bearing rather than
// stylistic: a separate-store container pays real byte copies, so a wall slate would hold a SECOND copy of every
// condemned delta while T32's drop() reported a byte-verified clean discard — H7 wearing a
// container, on the one surface whose report is a legal claim.
//
// THREE CLOSURES, three different machineries (the tidy "a closure is a set subtraction" is true of
// the SET and false of the code):
//   - `cite`   — ONE predicate (`slateRefusal`) at BOTH admission doors, differing only in
//                DISCLOSURE. Direct pointers only; and "direct" means NAMES A MEMBER, which
//                includes an enumerated primitive role that is a delta reference by convention
//                (today: `source-delta` on `loam.adoption`, which is how a promotion would
//                otherwise re-speak condemned content under a new id inside the window).
//   - `egress` — subtracted in `offeredDeltasImpl`, and the withheld set is NEGATION-CLOSED
//                TRANSITIVELY: withholding a strike while offering its target hands the peer a
//                live reading of a retracted claim (H1 read from the other side).
//   - `read`   — a GATHER-level narrowing in ONE helper (`readGround`), and the WARM path is
//                DEMOTED for the slate's lifetime because a materialization is not an operand set
//                anything can subtract from. `select` / `containerScope` / `Container.members` /
//                `freeze` / the re-freeze check / the operator's review read evaluate over the
//                UNNARROWED ground as an INVARIANT — narrowing them would make a read-closed slate
//                self-invalidate and jam its own cut forever.
//
// TWO CLOCKS, named. `deadline`, `requested-at`, and the `now` a door is passed are WALL-CLOCK
// milliseconds; a delta's own `timestamp` is DELTA-TIME (`max(Date.now(), last + 1)`) and may run
// ahead under load. They are never compared against each other.

import {
  DeltaSet,
  evalTerm,
  parseTerm,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "./container-identity.js";
import { CTX_CONTAINER, readContainerTable, containerScopeImpl } from "./container.js";
import { isTombstone } from "./erase.js";
import { withNegationClosure } from "./ingest.js";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";
import type { Gateway } from "./gateway.js";

/**
 * The entity both new records DECLARE — the marker that tells a slate record and a graveyard apart
 * from anything else wearing a `slate` pointer. It has to be a declaration and not the role alone:
 * every tombstone a cut mints carries `{role: "slate", …}` as §29.6's JOIN, so a reader keyed on
 * that role would read each of its own tombstones as a malformed slate record and jam the cut at its
 * second member. The same shape `isTombstone` uses, for the same reason.
 */
export const SLATE_ENTITY = "loam:erasure";
export const CTX_SLATE = "loam.erasure.slate";
export const CTX_GRAVEYARD = "loam.erasure.graveyard";
// The whole mint, enumerable — the vocabulary rail asserts the prefix discipline over this list.
export const SLATE_CONTEXTS = [CTX_SLATE, CTX_GRAVEYARD] as const;

/** The three doors a slate may close (§29.3). `none` is sayable and means the empty set. */
export type SlateClosure = "egress" | "cite" | "read";
const CLOSURES = new Set<string>(["egress", "cite", "read"]);
/** The refusal's recommendation: the minimum that makes the impact list and the orphan set true. */
export const RECOMMENDED_CLOSES = "egress,cite";

/**
 * Primitive roles that are a DELTA REFERENCE by convention rather than by encoding. The list is
 * CLOSED here, in code, beside the spec that closes it: a future role of the same shape is a spec
 * change rather than a silent hole. Today it is exactly one — `loam.adoption`'s link back to what a
 * promotion copied, `{role: "source-delta", target: {kind: "primitive", value: sourceDelta}}`.
 * `translates` is already a delta-ref and needs nothing here.
 */
export const PRIMITIVE_DELTA_REF_ROLES = ["source-delta"] as const;

// --- claim builders -----------------------------------------------------------------------------

const entityPtr = (role: string, id: string, context: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const primPtr = (role: string, value: string | number): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value },
});

export interface SlateSpec {
  /** The SHARED-posture container carrying the frozen condemned membership. */
  readonly container: string;
  /**
   * THE CONDEMNED SET, PINNED ON THE RECORD. The container declaration carries the same pair, but a
   * declaration is LATEST-WINS on `membershipAt`/`version` (only `trust`/`posture` are fixed to the
   * earliest), so a container alone cannot make §29.2's central claim that the set CANNOT GROW after
   * identification: one further operator-signed declaration mid-window would widen the address, every
   * door would pass, and the cut would destroy the widened set while the graveyard recorded it as the
   * set that had been identified. A record is content-addressed and immutable, so what it pins cannot
   * move; re-identifying is a NEW record. The door then requires the container to AGREE.
   */
  readonly membershipAt: string;
  readonly version: string;
  /** A plain identifier, or a §11 `sealCommitment(salt, subject)` — the FORM is named, never guessed. */
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  /** WALL-CLOCK ms: the compliance clock's start, distinct from the delta's own timestamp. */
  readonly requestedAt: number;
  /** WALL-CLOCK ms, REQUIRED — a legal deadline chosen silently by a library is the worst option. */
  readonly deadline: number;
  /** Which doors honour this slate. Required, no silent default; `[]` says `none` explicitly. */
  readonly closes: readonly SlateClosure[];
  readonly reason?: string;
  /** Kept walls the operator KNOWINGLY cuts around (§29.5) — a signature, not a footnote. */
  readonly acceptsIncomplete?: readonly string[];
}

export function slateClaims(spec: SlateSpec, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [
      entityPtr("declares", SLATE_ENTITY, CTX_SLATE),
      entityPtr("slate", spec.container, CTX_SLATE),
      primPtr("membershipAt", spec.membershipAt),
      primPtr("version", spec.version),
      primPtr("requested-by", spec.requestedBy),
      primPtr("requested-by-form", spec.requestedByForm),
      primPtr("requested-at", spec.requestedAt),
      primPtr("deadline", spec.deadline),
      ...(spec.closes.length === 0
        ? [primPtr("closes", "none")]
        : spec.closes.map((c) => primPtr("closes", c))),
      ...(spec.reason === undefined ? [] : [primPtr("reason", spec.reason)]),
      ...(spec.acceptsIncomplete ?? []).map((w) =>
        entityPtr("accepts-incomplete", w, CTX_CONTAINER),
      ),
    ],
  };
}

export interface GraveyardSpec {
  readonly container: string;
  readonly record: string;
  readonly version: string;
  readonly membershipAt: string;
  readonly memberCount: number;
  readonly opened: number;
  readonly cutAt: number;
  readonly closes: readonly SlateClosure[];
  readonly affected: readonly string[];
  readonly priorTombstone: readonly { readonly member: string; readonly tombstone: string }[];
}

// The erasure EVENT, not a second copy of the per-id law: it CITES tombstones and never replaces
// them (`readTombstones` stays the single per-id law), so it is one small delta whether the cut had
// four members or forty thousand. It holds content addresses; retaining a hash retains zero content.
export function graveyardClaims(spec: GraveyardSpec, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [
      entityPtr("declares", SLATE_ENTITY, CTX_GRAVEYARD),
      entityPtr("graveyard", spec.container, CTX_GRAVEYARD),
      entityPtr("slate", spec.container, CTX_SLATE),
      { role: "slate-record", target: { kind: "delta", deltaRef: { delta: spec.record } } },
      primPtr("version", spec.version),
      primPtr("membershipAt", spec.membershipAt),
      primPtr("member-count", spec.memberCount),
      primPtr("opened", spec.opened),
      primPtr("cut-at", spec.cutAt),
      ...(spec.closes.length === 0
        ? [primPtr("closes", "none")]
        : spec.closes.map((c) => primPtr("closes", c))),
      ...spec.affected.map((c) => entityPtr("affected", c, CTX_CONTAINER)),
      // JSON-encoded pairs: no separator can be ambiguous inside a content address, and the
      // enumeration must stay a CLOSED list a later checker reads rather than a heuristic.
      ...spec.priorTombstone.map((p) =>
        primPtr("prior-tombstone", JSON.stringify([p.member, p.tombstone])),
      ),
    ],
  };
}

/** The pointer a cut's tombstone carries so "which tombstones belong to this graveyard" is a JOIN. */
export function slatePointer(container: string): Claims["pointers"][number] {
  return entityPtr("slate", container, CTX_SLATE);
}

// --- shape readers -------------------------------------------------------------------------------

const at = (claims: Claims, role: string, context: string): string | undefined => {
  const p = claims.pointers.find(
    (x) => x.role === role && x.target.kind === "entity" && x.target.entity.context === context,
  );
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

const primitives = (claims: Claims, role: string): (string | number | boolean)[] =>
  claims.pointers
    .filter((p) => p.role === role && p.target.kind === "primitive")
    .map((p) => (p.target as { value: string | number | boolean }).value);

const entitiesAt = (claims: Claims, role: string, context: string): string[] =>
  claims.pointers
    .filter(
      (p) => p.role === role && p.target.kind === "entity" && p.target.entity.context === context,
    )
    .map((p) => (p.target as { entity: { id: string } }).entity.id);

const declaresSlateVocab = (claims: Claims, context: string): boolean =>
  at(claims, "declares", context) === SLATE_ENTITY;

export const isSlateRecord = (claims: Claims): boolean => declaresSlateVocab(claims, CTX_SLATE);

export const isGraveyard = (claims: Claims): boolean => declaresSlateVocab(claims, CTX_GRAVEYARD);

// --- the door validator (wired into authorize beside eraseDefect and containerDefect) -----------

// Is this delta slate vocabulary, and if so, is it WELL-FORMED, AUTHORIZED law? A slate closes
// doors and stages a destruction, so it takes erasure's own discipline: ONE authority, the instance
// operator, checked at EVERY door that could admit one, so an unlawful removal-order is never even
// stored. The state-dependent halves — the posture/trust refusal and the frozen-membership
// agreement — are what turn "frozen" from a convention into an invariant.
export function slateDefect(
  delta: Delta,
  reactor: Reactor,
  operator: string | undefined,
): string | undefined {
  const claims = delta.claims;
  if (isGraveyard(claims)) return graveyardDefect(claims, operator);
  if (!isSlateRecord(claims)) return undefined;
  const shape = slateShapeDefect(claims, operator);
  if (shape !== undefined) return shape;
  return slateStateDefect(claims, reactor, operator!);
}

/**
 * The record's own SHAPE and authority — everything decidable from the delta alone. Split from the
 * state-dependent half deliberately: the DOOR asks both, while the READER asks only this, because a
 * reader that dropped a slate whose container moved out from under it would silently REOPEN every
 * door the slate had closed. A state problem is reported by the reader as `unresolved` and refuses
 * the cut; it never makes a standing slate disappear.
 */
function slateShapeDefect(claims: Claims, operator: string | undefined): string | undefined {
  if (operator === undefined || claims.author !== operator) {
    return (
      "a slate is the instance operator's alone: only the operator may stage a removal " +
      `(this record is signed by ${claims.author})`
    );
  }
  for (const role of ["membershipAt", "version"] as const) {
    const vals = primitives(claims, role);
    if (vals.length !== 1 || typeof vals[0] !== "string" || vals[0].length === 0) {
      return (
        `a slate record PINS its condemned set: exactly one string \`${role}\`. A container ` +
        `declaration is latest-wins on this pair, so pinning only there would let one further ` +
        `declaration widen the set mid-window with every door still passing — the set could GROW ` +
        `after identification, which is the one thing §29.2 exists to forbid.`
      );
    }
  }
  const requestedBy = primitives(claims, "requested-by");
  if (requestedBy.length !== 1 || typeof requestedBy[0] !== "string") {
    return "a slate record carries exactly one string `requested-by` (an identifier, or a §11 seal)";
  }
  const form = primitives(claims, "requested-by-form");
  if (form.length !== 1 || (form[0] !== "plain" && form[0] !== "sealed")) {
    return (
      'a slate record NAMES the form its `requested-by` took: "plain" or "sealed" — a reader of a ' +
      "permanent compliance record must never be left guessing whether an identifier is a preimage"
    );
  }
  const requestedAt = primitives(claims, "requested-at");
  if (requestedAt.length !== 1 || typeof requestedAt[0] !== "number") {
    return "a slate record carries exactly one numeric `requested-at` (WALL-CLOCK ms, the compliance clock's start)";
  }
  const deadline = primitives(claims, "deadline");
  if (deadline.length !== 1 || typeof deadline[0] !== "number") {
    return (
      "a slate record carries exactly one numeric `deadline` (WALL-CLOCK ms), REQUIRED with no " +
      "default — a compliance clock runs from the request, and a legal deadline chosen silently " +
      "by a library is the worst of the options"
    );
  }
  const closes = primitives(claims, "closes");
  if (closes.length === 0) {
    return (
      "a slate record must say which doors it closes — `closes` is REQUIRED with no silent " +
      `default. The recommendation is \`${RECOMMENDED_CLOSES}\` (the minimum that makes both the ` +
      "impact list and the orphan set true at cut time), `read` is what a lapsed deadline forces, " +
      'and an announcement-only slate says `closes: "none"` explicitly'
    );
  }
  if (closes.some((c) => typeof c !== "string" || (c !== "none" && !CLOSURES.has(c)))) {
    return 'a slate closes some of "egress", "cite", "read" — or says "none" explicitly';
  }
  if (closes.includes("none") && closes.length > 1) {
    return '`closes: "none"` is the whole set or none of it — it cannot be listed beside a door';
  }
  const reasons = primitives(claims, "reason");
  if (reasons.length > 1 || (reasons.length === 1 && typeof reasons[0] !== "string")) {
    return "a slate record carries at most one string `reason`";
  }
  return undefined;
}

// The knobs, enforced with the posture, and the frozen-membership AGREEMENT. A wall slate holds a
// second copy of every condemned delta and its drop() would report a byte-verified clean discard over
// legible originals (H7); it is also self-blocking (§27.7 refuses every erase while a declared wall
// is unattached) and is exactly the "slate becomes the hiding place" recursion §24.8 warns about. All
// three problems vanish at property posture, so the posture is not a preference. Asked at the DOOR
// only — see `slateShapeDefect` for why the reader must not.
function slateStateDefect(claims: Claims, reactor: Reactor, operator: string): string | undefined {
  const container = at(claims, "slate", CTX_SLATE)!;
  const pinned = pinsOf(claims)!; // the shape check proved both present
  // The PINNED Term must be published, extensional, and freeze to the PINNED version. All three read
  // the record's own pointers, never the container's, so nothing a later declaration does can move
  // what this door certified.
  const frozen = readFrozenTerm(reactor, pinned.membershipAt);
  if (!frozen.ok) return `slate "${container}": ${frozen.why} (H9: the record fails closed)`;
  const agreed = freezeAgreement(reactor, frozen.term, pinned.version);
  if (agreed !== undefined) return `slate "${container}": ${agreed}`;

  const table = readContainerTable(reactor, operator);
  const rec = table.containers.get(container);
  if (rec === undefined) return undefined; // no container yet: inert data, and the cut fails closed
  if (rec.posture !== "shared" || rec.trust !== "curated") {
    return (
      `a slate must name a curated/shared container — "${container}" is declared ` +
      `${rec.trust}/${rec.posture}. A SEPARATE-STORE slate would hold a SECOND COPY of every condemned ` +
      `delta, so dropping it would report a byte-verified clean discard while every canonical ` +
      `original still sat in the primary; and an untrusted container cannot take posture ` +
      `"shared" at all (§28.3). Re-declare the slate's container curated/shared.`
    );
  }
  const disagreement = containerDisagreement(rec, pinned);
  if (disagreement !== undefined) return `slate "${container}": ${disagreement}`;
  return undefined;
}

/** The condemned set a record PINS. Undefined only for a record the shape check would have refused. */
function pinsOf(claims: Claims): { membershipAt: string; version: string } | undefined {
  const membershipAt = primitives(claims, "membershipAt")[0];
  const version = primitives(claims, "version")[0];
  if (typeof membershipAt !== "string" || typeof version !== "string") return undefined;
  return { membershipAt, version };
}

// A container may not point somewhere else while a slate over it stands. The record's pins GOVERN —
// they are immutable — so this disagreement never changes the condemned set; it is reported so the
// operator learns their re-declaration bound nothing, rather than believing it re-identified the set.
function containerDisagreement(
  rec: { membershipAt?: string; version?: string },
  pinned: { membershipAt: string; version: string },
): string | undefined {
  if (rec.membershipAt === pinned.membershipAt && rec.version === pinned.version) return undefined;
  return (
    `its container now declares membershipAt=${rec.membershipAt ?? "(absent)"} / ` +
    `version=${rec.version ?? "(absent)"}, while the standing record PINS ` +
    `membershipAt=${pinned.membershipAt} / version=${pinned.version}. A slate's condemned set is ` +
    `fixed at identification and cannot be re-pointed underneath it — strike the record and file a ` +
    `new one to condemn a different set (un-slating is free, §29.8).`
  );
}

function graveyardDefect(claims: Claims, operator: string | undefined): string | undefined {
  if (operator === undefined || claims.author !== operator) {
    return "a graveyard is the instance operator's alone: only the operator records an erasure event";
  }
  if (at(claims, "slate", CTX_SLATE) === undefined) {
    return "a graveyard names the slate it closed (an entity pointer at " + CTX_SLATE + ")";
  }
  for (const role of ["version", "membershipAt"] as const) {
    const vals = primitives(claims, role);
    if (vals.length !== 1 || typeof vals[0] !== "string") {
      return `a graveyard carries exactly one string \`${role}\``;
    }
  }
  for (const role of ["member-count", "opened", "cut-at"] as const) {
    const vals = primitives(claims, role);
    if (vals.length !== 1 || typeof vals[0] !== "number") {
      return `a graveyard carries exactly one numeric \`${role}\``;
    }
  }
  for (const pair of primitives(claims, "prior-tombstone")) {
    if (typeof pair !== "string" || parsePriorPair(pair) === undefined) {
      return "a graveyard's prior-tombstone entries are JSON [memberId, tombstoneId] pairs";
    }
  }
  return undefined;
}

const parsePriorPair = (raw: string): { member: string; tombstone: string } | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [member, tombstone] = parsed as unknown[];
    if (typeof member !== "string" || typeof tombstone !== "string") return undefined;
    return { member, tombstone };
  } catch {
    return undefined;
  }
};

// --- the frozen membership -----------------------------------------------------------------------

/**
 * The published Term at a `membershipAt` address, plus the ids it names EXTENSIONALLY. The door
 * predicate needs NO SCAN: a frozen membership is `match{field: id, cmp: inSet}`, so the condemned
 * ids are literally the values in the published Term's JSON and a slated-id lookup is a `Set.has` —
 * the same cost class as the `readTombstones` check that already runs at both doors (H8, answered).
 *
 * A NON-EXTENSIONAL TERM IS A FAILURE, never an empty set. `author eq X` freezes to a perfectly
 * honest address, so `freezeAgreement` alone certifies it — and if that certification stood while the
 * id set read empty, every closure would withhold nothing, the review would tell the operator
 * "nothing", and no field would say anything was wrong. So the shape is a first-class verdict and
 * every caller must handle the failure leg.
 */
export type FrozenTerm =
  | { readonly ok: true; readonly term: unknown; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly why: string };

export function readFrozenTerm(reactor: Reactor, membershipAt: string): FrozenTerm {
  const published = reactor.get(membershipAt);
  if (published === undefined) {
    return {
      ok: false,
      why: `the membership address ${membershipAt} resolves to nothing here — partial federation, a missing publish, or an erased Term`,
    };
  }
  const raw = primitives(published.claims, "term")[0];
  if (typeof raw !== "string") {
    return { ok: false, why: `the delta at ${membershipAt} publishes no Term under role \`term\`` };
  }
  let term: unknown;
  try {
    term = JSON.parse(raw);
  } catch {
    return { ok: false, why: `the Term at ${membershipAt} is not parseable JSON` };
  }
  const ids = extensionalIds(term);
  if (ids === undefined) {
    return {
      ok: false,
      why:
        `the Term at ${membershipAt} is not an EXTENSIONAL id set — a slate's membership must be ` +
        `\`match{field: "id", cmp: "inSet"}\` over the frozen ids (frozenMembershipTerm builds it). ` +
        `A live predicate keeps admitting deltas as they arrive, so the condemned set would drift ` +
        `and under-report silently, and a Term whose ids cannot be read out closes no door at all`,
    };
  }
  return { ok: true, term, ids };
}

// The ids a frozen membership Term names, read out of its JSON rather than evaluated. UNDEFINED —
// never an empty set — for any other shape, so "no ids" and "not extensionally frozen" can never be
// the same answer.
function extensionalIds(term: unknown): Set<string> | undefined {
  const t = term as { op?: unknown; pred?: { match?: Record<string, unknown> } };
  const m = t?.pred?.match;
  if (t?.op !== "select" || m === undefined) return undefined;
  if (m["field"] !== "id" || m["cmp"] !== "inSet" || !Array.isArray(m["const"])) return undefined;
  const out = new Set<string>();
  for (const v of m["const"] as unknown[]) {
    if (typeof v !== "string") return undefined;
    out.add(v);
  }
  return out;
}

/** The extensional membership Term for a frozen id set — what `termClaims` publishes. */
export function frozenMembershipTerm(ids: readonly string[]): unknown {
  return {
    op: "select",
    pred: { match: { field: "id", cmp: "inSet", const: [...ids].sort() } },
    in: "input",
  };
}

// AGREEMENT is what turns "frozen" from a convention into an invariant: evaluate the Term at
// `membershipAt`, freeze the result, and refuse unless it equals `version`. Evaluated over the
// UNNARROWED ground, always — the §29.3 invariant. Returns a refusal string or undefined.
export function freezeAgreement(
  reactor: Reactor,
  term: unknown,
  version: string,
): string | undefined {
  let evaluated: string;
  try {
    // EXACTLY `Gateway.freeze`'s reading, and that identity is load-bearing: the door's check, the
    // cut's pre-flight and criterion 18's invariant all compare against the same address, so the
    // §27.2 negation closure (H1/T38 — a version must not ship a claim without its retraction) has
    // to be on this side of the comparison too. Computed off the bare Reactor, never a Gateway, so
    // no read-door narrowing can reach the membership machinery (§29.3).
    evaluated = freezeMembers(withNegationClosure({ reactor }, evalMembership(reactor, term))).id;
  } catch (err) {
    return `its membership Term could not be evaluated (${err instanceof Error ? err.message : String(err)})`;
  }
  if (evaluated !== version) {
    return (
      `its membership does not freeze to the version it declares (${evaluated} ≠ ${version}) — a ` +
      `declaration whose membership could still move is refused rather than trusted`
    );
  }
  return undefined;
}

// The membership Term over the store's surviving ground. Deliberately NOT `gw.select` (which would
// bring the read-closure narrowing into the membership machinery and jam the cut, §29.3) — the
// reader takes a bare Reactor for exactly that reason: there is no gateway here to narrow.
function evalMembership(reactor: Reactor, term: unknown): Delta[] {
  const result = evalTerm(parseTerm(term), reactor.snapshot());
  if (result.sort !== "dset") throw new Error("a membership Term must select a delta set");
  return [...result.set];
}

// --- the slate reader ----------------------------------------------------------------------------

export interface Slate {
  readonly record: string;
  readonly container: string;
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  readonly requestedAt: number;
  readonly deadline: number;
  readonly reason?: string;
  readonly acceptsIncomplete: readonly string[];
  /** What `closes` SAYS — before the lapse is applied. */
  readonly declared: readonly SlateClosure[];
  /** What is in force at the moment this reader was passed. A lapsed deadline adds `read`. */
  readonly closes: ReadonlySet<SlateClosure>;
  readonly lapsed: boolean;
  readonly members: ReadonlySet<string>;
  /** The record's OWN pinned pair — immutable, and what every door and the cut evaluate over. */
  readonly version: string;
  readonly membershipAt: string;
  /** Why the condemned set could not be READ. Such a slate enforces NOTHING and the cut REFUSES. */
  readonly unresolved?: string;
  /**
   * The container was re-declared to point somewhere else. The record's pins still govern, so the
   * condemned set has NOT moved and every door keeps enforcing — this says the re-declaration bound
   * nothing, so an operator cannot mistake it for having re-identified the set.
   */
  readonly disagreement?: string;
}

/**
 * What a slate ACTUALLY enforces at this moment, which is not always what it declares. A slate whose
 * condemned set cannot be read closes nothing, because every closure is seeded FROM the member set —
 * so reporting `closes` as though it were in force would be a claim of protection never delivered
 * (H7 on the reporting side of a suppression mechanism).
 */
export const enforcedBy = (slate: Slate): SlateClosure[] =>
  slate.unresolved !== undefined || slate.members.size === 0 ? [] : [...slate.closes].sort();

/**
 * Every surviving lawful slate, with each one's closure set resolved AT THE MOMENT `now`.
 *
 * The lapse is a READ-TIME VERDICT because nothing in Loam runs a timer and this design must not
 * pretend one exists: a slate whose `deadline` is past resolves with `read` added. That fails SAFE
 * (a store down for a week wakes with read already closed), needs no scheduler, and gives the rails
 * a deterministic seam — an explicit `now`, never a wall-clock race.
 *
 * `now` is WALL-CLOCK ms and is compared only against `deadline`, never against a delta's own
 * DELTA-TIME timestamp (`nextTimestamp()` is `max(Date.now(), last + 1)` and may run ahead).
 */
export function readSlates(reactor: Reactor, operator: string | undefined, now: number): Slate[] {
  if (operator === undefined) return []; // an ungoverned store has no lawful voice, so no slates
  requireMoment(now, "readSlates");
  // The cheap existence probe first (the `deadSet` discipline, H8): a store holding no slate record
  // at all answers without paying for the negation materialization or the container table. It
  // decides nothing else — which records SURVIVE stays the one place below that owns the rule.
  let any = false;
  for (const d of reactor.snapshot()) {
    if (d.claims.author === operator && isSlateRecord(d.claims)) {
      any = true;
      break;
    }
  }
  if (!any) return [];

  const negated = lawfulNegated(reactor, operator);
  const table = readContainerTable(reactor, operator);
  const out: Slate[] = [];
  for (const delta of lawfulSnapshot(reactor, operator)) {
    if (negated(delta.id) || !isSlateRecord(delta.claims)) continue;
    // SHAPE only. A malformed record binds nothing, at the reader as at the door; but a record whose
    // CONTAINER has moved is reported below rather than dropped, because dropping it would silently
    // reopen every door the slate had closed at exactly the moment its state became unreadable.
    if (slateShapeDefect(delta.claims, operator) !== undefined) continue;
    const claims = delta.claims;
    const container = at(claims, "slate", CTX_SLATE)!;
    const pinned = pinsOf(claims)!; // the shape check above proved both present
    const rec = table.containers.get(container);
    const declaredRaw = primitives(claims, "closes").filter(
      (c): c is SlateClosure => typeof c === "string" && CLOSURES.has(c),
    );
    const declared = [...new Set(declaredRaw)];
    const deadline = primitives(claims, "deadline")[0] as number;
    const lapsed = now > deadline;
    const closes = new Set<SlateClosure>(declared);
    if (lapsed) closes.add("read"); // §29.4: the lapse TIGHTENS, computed at the door
    const base = {
      record: delta.id,
      container,
      requestedBy: primitives(claims, "requested-by")[0] as string,
      requestedByForm: primitives(claims, "requested-by-form")[0] as "plain" | "sealed",
      requestedAt: primitives(claims, "requested-at")[0] as number,
      deadline,
      ...(typeof primitives(claims, "reason")[0] === "string"
        ? { reason: primitives(claims, "reason")[0] as string }
        : {}),
      acceptsIncomplete: entitiesAt(claims, "accepts-incomplete", CTX_CONTAINER),
      declared,
      closes,
      lapsed,
      // The record's OWN pins, never the container's: a declaration is latest-wins on this pair, so
      // reading the set from the container is what would let it move mid-window.
      membershipAt: pinned.membershipAt,
      version: pinned.version,
    };
    // A struck container declaration is UN-SLATING (§29.8), not an unresolved slate: the table is
    // re-resolved live, so every closed door reopens on the next read and there is nothing left to
    // report. The record itself stands — someone asked, and that is a fact §11 already holds — but a
    // record with no container is not a slate.
    if (rec === undefined) continue;
    const frozen = readFrozenTerm(reactor, pinned.membershipAt);
    // UNRESOLVED means the condemned set cannot be READ, so this slate enforces NOTHING and says so
    // (`enforced` below is empty and `slateHealth` counts it). It is not silence: the doors cannot
    // withhold an unknown set, and refusing every read instead would let one erased delta take the
    // store down — a worse failure, triggerable by the one party who can un-slate for free. The two
    // ways INTO this state are closed at their sources instead: `eraseImpl` refuses to erase a
    // standing slate's pinned Term, and the cut refuses a member that is one. What remains is the
    // honest case — a store that never received the Term at all, where there is genuinely nothing to
    // enforce because this store never held the ids.
    if (!frozen.ok) {
      out.push({ ...base, members: new Set(), unresolved: frozen.why });
      continue;
    }
    const disagreement = containerDisagreement(rec, pinned);
    if (disagreement !== undefined) {
      // The record's pins still GOVERN — they are immutable, so the set has not moved and every door
      // keeps enforcing over it. The disagreement is reported, not obeyed.
      out.push({ ...base, members: frozen.ids, disagreement });
      continue;
    }
    out.push({ ...base, members: frozen.ids });
  }
  out.sort((a, b) => (a.record < b.record ? -1 : a.record > b.record ? 1 : 0));
  return out;
}

/**
 * The moment is REQUIRED on the internal read seam, and a door reached without it FAILS CLOSED and
 * loudly. An optional `now` defaulting to anything at all would serve a member past a lapsed
 * deadline and look healthy doing it — the fail-open direction is the one that matters here.
 */
export function requireMoment(now: number, what: string): void {
  if (typeof now !== "number" || !Number.isFinite(now)) {
    throw new Error(
      `${what} refused: no moment was passed. A slate's lapse is computed AT THE DOOR, so every ` +
        `door that honours \`read\` needs the caller's WALL-CLOCK \`now\` — a missing moment is a ` +
        `programming error that fails closed, never a read that quietly ignores a lapsed deadline.`,
    );
  }
}

// --- the operator's review read ------------------------------------------------------------------

export interface Duplicate {
  readonly member: string;
  /** An operator-authored record that LINKS to the member by a link the store can follow. */
  readonly record: string;
  readonly role: string;
}

export interface SlateReport extends Omit<Slate, "members" | "closes"> {
  /** What the record SAYS, plus a lapse. Not the same question as what is in force. */
  readonly closes: readonly SlateClosure[];
  /**
   * What is ACTUALLY being enforced. Every closure is seeded from the member set, so a slate whose
   * condemned set cannot be read closes NOTHING — and reporting `closes` as though it were in force
   * would be a claim of protection never delivered, on the one surface whose report is a legal claim.
   */
  readonly enforced: readonly SlateClosure[];
  readonly members: readonly string[];
  /** Targets of slated NEGATIONS — the claims that will come back to life at the cut (§29.3). */
  readonly resurfacing: readonly string[];
  /**
   * Containers whose intersection with the condemned set could NOT be computed — an unattached wall,
   * a dangling membership. Named rather than silently excluded (H9), and empty whenever a cut is
   * possible at all, because the cut refuses on exactly this state.
   */
  readonly affectedUnknown: readonly string[];
  /** Containers whose scope intersects the condemned set. Never "who was notified" (§29.9). */
  readonly affected: readonly string[];
  /**
   * Operator-authored records that link to a member. An HONEST PARTIAL: it finds LINKS, never
   * content — a copy re-spoken before the slate is outside its reach by construction, and no
   * widening of any predicate changes that. It must be slated by its own id.
   */
  readonly duplicates: readonly Duplicate[];
}

/**
 * The operator's REVIEW read (§29.3). Read closure never closes this: the operator is the
 * controller and must be able to examine what they are about to destroy, so this evaluates over the
 * UNNARROWED ground even for a slate that closes `read`.
 */
export function slateReportsImpl(gw: Gateway, now: number): SlateReport[] {
  const slates = readSlates(gw.reactor, gw.operatorAuthor, now);
  return slates.map((s) => {
    const reach = affectedContainers(gw, s.members, s.container);
    return {
      ...s,
      closes: [...s.closes].sort(),
      enforced: enforcedBy(s),
      members: [...s.members].sort(),
      resurfacing: resurfacingOf(gw.reactor, s.members),
      affected: reach.affected,
      affectedUnknown: reach.unknown,
      duplicates: duplicatesOf(gw, s.members),
    };
  });
}

// If a member is a NEGATION, cutting it REVIVES its target (§11's own consequence) — so the review
// lists it BEFORE the cut, which no single-act erasure could ever show.
function resurfacingOf(reactor: Reactor, members: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const id of members) {
    const d = reactor.get(id);
    if (d === undefined) continue;
    for (const p of d.claims.pointers) {
      if (p.role === "negates" && p.target.kind === "delta") {
        const target = p.target.deltaRef.delta;
        if (!members.has(target) && reactor.get(target) !== undefined) out.add(target);
      }
    }
  }
  return [...out].sort();
}

// The AFFECTED SET — the strongest claim the store can actually make (§29.9): there is no
// notification transport in Loam, so this can never be "who was notified". Walks the resolved
// table once per container; a cut is a rare, deliberate act, so the cost is paid where it belongs.
function affectedContainers(
  gw: Gateway,
  members: ReadonlySet<string>,
  self: string,
): { affected: string[]; unknown: string[] } {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const affected: string[] = [];
  const unknown: string[] = [];
  for (const name of [...table.containers.keys()].sort()) {
    if (name === self) continue;
    // A scope that cannot be READ cannot be excluded either (H9), so it is named as UNDETERMINED
    // rather than skipped — and the operator's review read must not throw because some unrelated
    // wall is unattached. The CUT refuses on exactly this state, so the undetermined list is empty
    // at every moment the affected set becomes durable.
    try {
      const scoped = containerScopeImpl(gw, { containers: [name] });
      if (scoped.some((d) => members.has(d.id))) affected.push(name);
    } catch {
      unknown.push(name);
    }
  }
  return { affected, unknown };
}

function duplicatesOf(gw: Gateway, members: ReadonlySet<string>): Duplicate[] {
  if (members.size === 0) return [];
  const out: Duplicate[] = [];
  // THE WHOLE GROUND, not just the operator's own signature. A copy is a copy whoever signed it, and
  // the copies that matter most here are minted by STANDING PASSES under a pen or a granted author —
  // a rendering's `translates`, a promotion's `source-delta`. Scoping this to operator-authored
  // deltas made exactly those invisible to the one review that could surface them, and a review that
  // OVER-reports links costs an operator a second look while one that under-reports costs them the
  // copy. (Wider than §29.3's wording, which says "operator-authored"; the direction is deliberate.)
  for (const d of gw.reactor.snapshot()) {
    if (members.has(d.id) || isTombstone(d.claims) || isGraveyard(d.claims)) continue;
    for (const p of d.claims.pointers) {
      const named =
        p.target.kind === "delta"
          ? p.target.deltaRef.delta
          : p.target.kind === "primitive" &&
              typeof p.target.value === "string" &&
              (PRIMITIVE_DELTA_REF_ROLES as readonly string[]).includes(p.role)
            ? p.target.value
            : undefined;
      if (named !== undefined && members.has(named)) {
        out.push({ member: named, record: d.id, role: p.role });
      }
    }
  }
  out.sort((a, b) => (a.record + a.member < b.record + b.member ? -1 : 1));
  return out;
}

// --- health (§29.4): the compliance clock in its OWN section -------------------------------------

export interface SlateHealth {
  readonly open: number;
  readonly lapsed: number;
  /** The lapsed slates' container entities — operator-only, like `erasure.outstanding`. */
  readonly lapsedIds: readonly string[];
  /**
   * Slates ENFORCING NOTHING because their condemned set cannot be read. Surfaced because the
   * alternative is a slate reporting `closes: [cite, egress]` while all three doors stand open — a
   * claim of protection never delivered, and the one state an operator most needs to see.
   */
  readonly unresolved: readonly string[];
  /** Slates whose container was re-declared elsewhere. The record's pins still govern; this says so. */
  readonly disagreeing: readonly string[];
}

export interface ForgivenHealth {
  /** Ids in some graveyard's frozen `version` whose tombstone no longer survives. */
  readonly count: number;
  /** Of those, how many are PRESENT in the ground again. */
  readonly present: number;
  readonly ids: readonly string[];
  /**
   * Graveyards whose frozen set could NOT be read. Without this, `count: 0` means both "nothing has
   * been forgiven" and "the one durable list of ids this store promised to forget is unreadable" —
   * H9 in the instrument that exists to make a forgiven-and-returned id visible at all.
   */
  readonly unreadable: readonly string[];
}

/**
 * A lapsed slate does NOT move `status`, and the separation is the point. `settling` means a promise
 * already MADE has not reached the bytes yet and the operator waits or repairs a tier; a lapsed
 * slate means a promise has not been KEPT and the operator's job is to CUT. Routing a compliance
 * clock through §11's byte-debt field would teach whoever watches `status` that `settling` sometimes
 * just means someone filed a slate — which is how a field earns the right to be ignored.
 */
export function slateHealth(gw: Gateway, now: number): SlateHealth {
  const slates = readSlates(gw.reactor, gw.operatorAuthor, now);
  const lapsed = slates.filter((s) => s.lapsed);
  return {
    open: slates.length,
    lapsed: lapsed.length,
    lapsedIds: lapsed.map((s) => s.container).sort(),
    unresolved: slates
      .filter((s) => s.unresolved !== undefined)
      .map((s) => s.container)
      .sort(),
    disagreeing: slates
      .filter((s) => s.disagreement !== undefined)
      .map((s) => s.container)
      .sort(),
  };
}

// --- the cite closure ----------------------------------------------------------------------------

/**
 * ONE predicate, both admission doors (§29.3). Returns the container and the member a delta cites,
 * or undefined. The doors differ only in DISCLOSURE: `appendImpl` names the container (the only
 * parties who can trigger it are parties who could already read the target, so telling them IS the
 * notice), while `federateImpl` takes the uniform-refusal discipline (a peer pushing a citation may
 * have no read access, and a distinguishable refusal would announce that something exists and is
 * leaving).
 *
 * DIRECT only, deliberately: a Set lookup at admission, where transitive closure is the unbounded
 * scan H8 exists to warn about. But "direct" means NAMES A MEMBER — a delta-ref OR an enumerated
 * primitive role that is a delta reference by convention.
 *
 * AND A NEGATION IS NOT A CITATION (H1's T43 site, exactly). Cite closure exists so the DEPENDENT set
 * cannot grow; a strike adds no dependent — it REMOVES a claim, which is the one direction a
 * suppression window has no reason to refuse. Refusing one strands it: at the append door a caller's
 * own `clear` over a field with one slated contribution would retract none of their others (the batch
 * refuses whole), and at the federation door the refusal folds into the uniform `rejected += 1` while
 * union's idempotence means the peer never resends — so after un-slating the claim reads LIVE here and
 * RETRACTED at the peer, forever. The exemption is PER POINTER, so a delta that negates a member and
 * also cites it under some other role is still refused on that other role.
 */
export function slateRefusal(
  slates: readonly Slate[],
  delta: Delta,
): { container: string; member: string } | undefined {
  const claims = delta.claims;
  // The erasure vocabulary itself is not a citation that grows the dependent set — it IS the
  // removal. A tombstone names its target under `erases`, and the cut mints one per member; a
  // graveyard names the slate it closed. Refusing those would make a slate refuse its own cut.
  if (isTombstone(claims) || isGraveyard(claims)) return undefined;
  for (const slate of slates) {
    if (!slate.closes.has("cite") || slate.members.size === 0) continue;
    for (const p of claims.pointers) {
      if (p.role === "negates") continue; // a strike narrows; it never grows the dependent set
      if (p.target.kind === "delta" && slate.members.has(p.target.deltaRef.delta)) {
        return { container: slate.container, member: p.target.deltaRef.delta };
      }
      if (
        p.target.kind === "primitive" &&
        typeof p.target.value === "string" &&
        (PRIMITIVE_DELTA_REF_ROLES as readonly string[]).includes(p.role) &&
        slate.members.has(p.target.value)
      ) {
        return { container: slate.container, member: p.target.value };
      }
    }
  }
  return undefined;
}

// --- the withheld set (egress and read share ONE closure) ---------------------------------------

/**
 * The condemned set CLOSED UNDER NEGATION TARGETS, transitively — H1 read from the other side.
 *
 * `withNegationClosure` maintains *if I offer `d`, I offer everything that negates `d`*. Its
 * contrapositive is *if I withhold `n`, and `n` negates `d`, I withhold `d`*. Those are one rule,
 * so a naive subtraction of a slated NEGATION would leave its target offered and hand the peer a
 * live reading of a retracted claim. Transitive for the same reason the forward closure is (a
 * struck strike revives, so one link would leave a revived claim wrongly offered), and terminating
 * for the same reason (the set only grows, bounded by the snapshot, and content addressing forbids
 * a cycle).
 *
 * This UNDER-represents the post-cut world for exactly the resurfacing set, and that is the correct
 * direction: over-withholding cannot disclose, un-slating is FREE (§29.8), and a revocable act must
 * not have an irrevocable effect.
 */
export function condemnedClosure(reactor: Reactor, seed: Iterable<string>): Set<string> {
  const out = new Set(seed);
  const pending = [...out];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    const d = reactor.get(id);
    if (d === undefined) continue;
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = p.target.deltaRef.delta;
      if (out.has(target)) continue;
      out.add(target);
      pending.push(target);
    }
  }
  return out;
}

const closureIds = (
  reactor: Reactor,
  slates: readonly Slate[],
  door: SlateClosure,
): Set<string> => {
  const seed = new Set<string>();
  for (const s of slates) {
    if (!s.closes.has(door)) continue;
    for (const id of s.members) seed.add(id);
  }
  return seed.size === 0 ? seed : condemnedClosure(reactor, seed);
};

/** What EGRESS closure withholds from `offeredDeltas` — the one site, and `openWall` inherits it. */
export function egressWithheld(gw: Gateway, now: number): Set<string> {
  return closureIds(gw.reactor, readSlates(gw.reactor, gw.operatorAuthor, now), "egress");
}

/** What READ closure withholds from every gather that answers a read DOOR. */
export function readClosedIds(gw: Gateway, now: number): Set<string> {
  requireMoment(now, "a read door");
  return closureIds(gw.reactor, readSlates(gw.reactor, gw.operatorAuthor, now), "read");
}

/**
 * `snapshot ∖ readClosed` — the ONE helper every gather that answers a READ door evaluates over.
 * Read closure is a property of DOORS: `select`, `containerScope`, `Container.members`,
 * `Gateway.freeze`, §29.2's re-freeze and the operator's review read all evaluate over the
 * UNNARROWED ground, stated as an invariant rather than left to where the code happens to sit. The
 * tempting single choke point (`selectImpl`) is the one place this must never go — a read-closed
 * slate evaluating its own membership over a narrowed snapshot freezes to a different address than
 * `version`, self-invalidates, and jams its own cut forever at the exact moment the deadline passes.
 *
 * The unnarrowed list, so a reader can tell CONSIDERED from FORGOTTEN:
 *   - `select`, `Gateway.freeze`, `containerScope`, `Container.members`, §29.2's re-freeze — the
 *     membership machinery. Narrowing any of them is the deadlock above.
 *   - `Gateway.watch` — CONSIDERED, and deliberately unnarrowed: it is live `select`, the same
 *     primitive under a subscription, and it is what the membership machinery itself would watch.
 *     It is not a door serving a READING; a reader who wants the narrowed live view watches an
 *     ENTITY (`watchEntity`), which IS narrowed.
 *   - the operator's review read (`slates()`) — the controller must see what they will destroy.
 *   - the §14 RETRACTION gather (`gatherForRetraction`) — a write must see what it is retracting, or
 *     a caller's own strike becomes a silent no-op over a read-closed member.
 */
export function readGround(gw: Gateway, now: number): DeltaSet {
  return groundWithout(gw.reactor.snapshot(), readClosedIds(gw, now));
}

/** The same narrowing applied AFTER an as-of reconstruction (§26 × §29.3). */
export function readGroundAsOf(gw: Gateway, asOfGround: DeltaSet, now: number): DeltaSet {
  return groundWithout(asOfGround, readClosedIds(gw, now));
}

const groundWithout = (ground: DeltaSet, closed: ReadonlySet<string>): DeltaSet =>
  closed.size === 0 ? ground : DeltaSet.from([...ground].filter((d) => !closed.has(d.id)));

/**
 * Did this batch just close `read` over something? A STREAM OPEN BEFORE THE SLATE re-resolves, or it
 * serves the member forever (§29.3): nothing in a slate's own deltas touches the watched entity's
 * materialization, so the sink never fires and the narrowing never takes effect. Asked cheaply —
 * a batch with no slate record in it pays nothing.
 */
export function landsReadClosure(gw: Gateway, batch: readonly Delta[], now: number): boolean {
  if (!batch.some((d) => isSlateRecord(d.claims))) return false;
  return readClosedIds(gw, now).size > 0;
}
