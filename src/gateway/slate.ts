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

import { DeltaSet, type Claims, type Delta, type Reactor } from "@bombadil/rhizomatic";
import { containerScopeImpl, unreachableStoreReport } from "./container.js";
import { CTX_CONTAINER, readContainerTable, survivingDeclarationIds } from "./container-law.js";
import {
  ESM_RESIDENCY_DISCLOSURE,
  ERASURE_NON_CLAIMS,
  UNSWEPT_AUTH_SURFACES,
  isErasure,
  standingErasures,
  erasureTarget,
} from "./erase-law.js";
import { eraseImpl, erasureOutstanding } from "./erase.js";
import { lawfulHistory } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { Gateway } from "./gateway.js";
import { withStamp } from "./stamp.js";
import {
  PRIMITIVE_DELTA_REF_ROLES,
  isGraveyard,
  CTX_GRAVEYARD,
  SLATE_ENTITY,
  at,
  type Slate,
  type SlateClosure,
  freezeAgreement,
  evalMembership,
  readFrozenTerm,
  primitives,
  readSlates,
  requireMoment,
  readClosedIds,
  readGraveyards,
} from "./slate-law.js";
import { CTX_SLATE, entityPtr } from "./slate-vocab.js";
import { type CitationTier, reachableTiers, danglingCitations } from "./tiers.js";

// The whole mint, enumerable — the vocabulary rail asserts the prefix discipline over this list.
export const SLATE_CONTEXTS = [CTX_SLATE, CTX_GRAVEYARD] as const;
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
    validFrom: timestamp,
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
  readonly priorErasure: readonly { readonly member: string; readonly erasure: string }[];
}

// The erasure EVENT, not a second copy of the per-id law: it CITES erasures and never replaces
// them (`readErasures` stays the single per-id law), so it is one small delta whether the cut had
// four members or forty thousand. It holds content addresses; retaining a hash retains zero content.
export function graveyardClaims(spec: GraveyardSpec, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
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
      ...spec.priorErasure.map((p) =>
        primPtr("prior-erasure", JSON.stringify([p.member, p.erasure])),
      ),
    ],
  };
}

/** The extensional membership Term for a frozen id set — what `termClaims` publishes. */
export function frozenMembershipTerm(ids: readonly string[]): unknown {
  return {
    op: "select",
    pred: { match: { field: "id", cmp: "inSet", const: [...ids].sort() } },
    in: "input",
  };
}

/**
 * What a slate ACTUALLY enforces at this moment, which is not always what it declares. A slate whose
 * condemned set cannot be read closes nothing, because every closure is seeded FROM the member set —
 * so reporting `closes` as though it were in force would be a claim of protection never delivered
 * (H7 on the reporting side of a suppression mechanism).
 */
export const enforcedBy = (slate: Slate): SlateClosure[] =>
  slate.unresolved !== undefined || slate.members.size === 0 ? [] : [...slate.closes].sort();

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
  const slates = readSlates(gw.reactor, gw.validityNow(), gw.operatorAuthor, now);
  if (slates.length === 0) return [];
  // ONE SCOPE READ PER CONTAINER AND ONE WALK OF THE GROUND, FOR THE WHOLE LISTING. Asked per
  // slate, this was slates × containers × store, and every inner step re-hashed the ground from
  // scratch. That price is defensible for a CUT, which is a rare and deliberate act; `loam slate
  // list` is a routine read that paid it on every invocation (H8). The answers are identical —
  // only the loop nesting moved.
  const reach = affectedFor(
    gw,
    slates.map((s) => ({ members: s.members, container: s.container })),
  );
  const duplicates = duplicatesFor(
    gw,
    slates.map((s) => s.members),
  );
  return slates.map((s, i) => ({
    ...s,
    closes: [...s.closes].sort(),
    enforced: enforcedBy(s),
    members: [...s.members].sort(),
    resurfacing: resurfacingOf(gw.reactor, s.members),
    affected: reach[i]!.affected,
    affectedUnknown: reach[i]!.unknown,
    duplicates: duplicates[i]!,
  }));
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
  return affectedFor(gw, [{ members, container: self }])[0]!;
}

/**
 * The same question for EVERY slate at once: one scope read per container rather than one per pair.
 *
 * Only the CONDEMNED ids a container holds are kept, never its whole scope, so the memory this
 * trades for the scans is bounded by the members under review rather than by the store.
 */
function affectedFor(
  gw: Gateway,
  slates: readonly { members: ReadonlySet<string>; container: string }[],
): { affected: string[]; unknown: string[] }[] {
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const names = [...table.containers.keys()].sort();
  const wanted = new Set<string>();
  for (const s of slates) for (const id of s.members) wanted.add(id);
  const hits = new Map<string, Set<string> | "unknown">();
  for (const name of names) {
    // A scope that cannot be READ cannot be excluded either (H9), so it is named as UNDETERMINED
    // rather than skipped — and the operator's review read must not throw because some unrelated
    // wall is unattached. The CUT refuses on exactly this state, so the undetermined list is empty
    // at every moment the affected set becomes durable.
    try {
      const here = new Set<string>();
      for (const d of containerScopeImpl(gw, { containers: [name] })) {
        if (wanted.has(d.id)) here.add(d.id);
      }
      hits.set(name, here);
    } catch {
      hits.set(name, "unknown");
    }
  }
  return slates.map((s) => {
    const affected: string[] = [];
    const unknown: string[] = [];
    for (const name of names) {
      if (name === s.container) continue;
      const here = hits.get(name)!;
      if (here === "unknown") unknown.push(name);
      else if ([...s.members].some((id) => here.has(id))) affected.push(name);
    }
    return { affected, unknown };
  });
}

function duplicatesOf(gw: Gateway, members: ReadonlySet<string>): Duplicate[] {
  return duplicatesFor(gw, [members])[0]!;
}

/**
 * Every slate's links, found in ONE walk of the ground rather than one walk per slate.
 *
 * THE WHOLE GROUND, not just the operator's own signature. A copy is a copy whoever signed it, and
 * the copies that matter most here are minted by STANDING PASSES under a pen or a granted author —
 * a rendering's `translates`, a promotion's `source-delta`. Scoping this to operator-authored
 * deltas made exactly those invisible to the one review that could surface them, and a review that
 * OVER-reports links costs an operator a second look while one that under-reports costs them the
 * copy. (Wider than §29.3's wording, which says "operator-authored"; the direction is deliberate.)
 */
function duplicatesFor(gw: Gateway, slates: readonly ReadonlySet<string>[]): Duplicate[][] {
  const out = slates.map(() => [] as Duplicate[]);
  const wanted = new Set<string>();
  for (const members of slates) for (const id of members) wanted.add(id);
  if (wanted.size === 0) return out;
  for (const d of gw.reactor.snapshot()) {
    if (wanted.has(d.id) || isErasure(d.claims) || isGraveyard(d.claims)) continue;
    for (const p of d.claims.pointers) {
      const named =
        p.target.kind === "delta"
          ? p.target.deltaRef.delta
          : p.target.kind === "primitive" &&
              typeof p.target.value === "string" &&
              (PRIMITIVE_DELTA_REF_ROLES as readonly string[]).includes(p.role)
            ? p.target.value
            : undefined;
      if (named === undefined || !wanted.has(named)) continue;
      slates.forEach((members, i) => {
        if (members.has(named)) out[i]!.push({ member: named, record: d.id, role: p.role });
      });
    }
  }
  for (const rows of out) {
    rows.sort((a, b) => (a.record + a.member < b.record + b.member ? -1 : 1));
  }
  return out;
}

// --- the read ground -----------------------------------------------------------------------------

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

// --- the cut -------------------------------------------------------------------------------------

/**
 * A per-tier byte verdict, TRI-STATE. A tier that refused, a tier that threw, and a `kept` wall are
 * all "we did not prove these bytes are gone" — the opposite of "we proved they are gone", and a
 * boolean cannot hold the difference. `health()` already carries `unproven` for exactly this fact.
 * Collapsing the third state into `false` is how a report of work NOT DONE reads as work completed.
 */
export type ByteVerdict = false | true | "unproven";

export interface TierVerdict {
  readonly tier: string;
  readonly holds: ByteVerdict;
}

export interface CutMemberReport {
  readonly member: string;
  readonly erasure: string;
  readonly spokenBy: string;
  /** OBSERVATION, at `window.cutAt`. Non-authoritative for a re-issue — see RECEIPT_FIELDS. */
  readonly tiers: readonly TierVerdict[];
  /** §11's citations manifest: the surviving deltas that dangle at this hole, across every tier. */
  readonly citations: readonly string[];
  /** The same manifest, attributed to the tier each dangler lives on (T216) — the additive half of
   * the flat `citations` list. Not in RECEIPT_FIELDS: that partition is frozen (T64), and this is a
   * refinement of `citations` (history), carrying no byte verdict a formatter could misread. */
  readonly citationTiers: readonly CitationTier[];
}

export interface CutReport {
  readonly slate: string;
  readonly record: string;
  readonly graveyard: string;
  readonly version: string;
  readonly memberCount: number;
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  readonly requestedAt: number;
  readonly deadline: number;
  readonly reason?: string;
  readonly closes: readonly SlateClosure[];
  readonly window: { readonly opened: number; readonly cutAt: number };
  readonly members: readonly CutMemberReport[];
  /** Members a surviving lawful erasure ALREADY covered (§29.5's one lawful exception). */
  readonly priorErasure: readonly { readonly member: string; readonly erasure: string }[];
  /** Tiers deliberately NOT reached, each with the declaration that permitted it. */
  readonly notReached: readonly { readonly wall: string; readonly acceptsIncomplete: string }[];
  readonly affected: readonly string[];
  readonly resurfacing: readonly string[];
  readonly duplicates: readonly Duplicate[];
  /** The report's OWN partition, carried so a formatter cannot mistake one side for the other. */
  readonly observationOnly: readonly string[];
}

/**
 * The §29.7 receipt's fields, PARTITIONED. A history field is a fact about what HAPPENED and the
 * CutReport is a good source for it forever. A per-tier byte verdict is an OBSERVATION OF THE TIERS
 * at a moment and may never be read from a CutReport later: a formatter that reprints last month's
 * snapshot as today's receipt is the whole dry-run mistake this design rejects, wearing letterhead.
 */
export const RECEIPT_FIELDS: readonly {
  readonly field: string;
  readonly side: "history" | "observation";
}[] = [
  { field: "window", side: "history" },
  { field: "version", side: "history" },
  { field: "memberCount", side: "history" },
  { field: "requestedBy", side: "history" },
  { field: "requestedByForm", side: "history" },
  { field: "requestedAt", side: "history" },
  { field: "deadline", side: "history" },
  { field: "closes", side: "history" },
  { field: "erasure", side: "history" },
  { field: "spokenBy", side: "history" },
  { field: "priorErasure", side: "history" },
  { field: "citations", side: "history" },
  { field: "duplicates", side: "history" },
  { field: "affected", side: "history" },
  { field: "resurfacing", side: "history" },
  { field: "graveyard", side: "history" },
  { field: "notReached", side: "history" },
  { field: "tiers", side: "observation" },
  { field: "presentAgain", side: "observation" },
  { field: "negated", side: "observation" },
];

const OBSERVATION_FIELDS = RECEIPT_FIELDS.filter((f) => f.side === "observation").map(
  (f) => f.field,
);

const retractionOf = (targetId: string, author: string, timestamp: number): Claims => ({
  timestamp,
  validFrom: timestamp,
  author,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
});

/**
 * THE CUT (§29.5). Pre-flight is ALL-OR-REFUSE; the per-member work is per-member with a fault
 * report — atomicity is claimed only where it is real, because erasure is not transactional across
 * tiers and a mirror going down mid-cut is a physical state, not a bug.
 *
 * Order is load-bearing: the graveyard lands and only THEN is the declaration struck. Strike first
 * and a crash loses the record, because the struck declaration no longer resolves the set. A crash
 * between the two leaves a graveyard beside a standing slate whose members are all erased, so
 * the re-run finds nothing outstanding and simply strikes — idempotent by construction.
 */
export async function cutImpl(
  gw: Gateway,
  container: string,
  opts: { now?: number } = {},
): Promise<CutReport> {
  const signer = gw.signer;
  const operator = gw.operatorAuthor;
  if (signer === undefined || operator === undefined) {
    throw new Error("a cut is the instance operator's alone, and this store has no operator");
  }
  const now = opts.now ?? Date.now();
  requireMoment(now, "cut");
  const refuse = (why: string): never => {
    throw new Error(
      `cut ${container} refused before any erasure landed: ${why}\n` +
        `The slate STANDS — every closed door stays closed, the declaration still resolves, and ` +
        `the cut is resumable once this is repaired.`,
    );
  };

  const slate = readSlates(gw.reactor, gw.validityNow(), operator, now).find(
    (s) => s.container === container,
  );
  if (slate === undefined) {
    throw new Error(
      `cut ${container} refused: no surviving lawful slate record names that container — a slate ` +
        `is a record POINTING at a container, never a naming convention`,
    );
  }
  if (slate.unresolved !== undefined) {
    refuse(
      `${slate.unresolved}. If we cannot read which ids are condemned we cannot cut (H9: fail closed)`,
    );
  }
  if (slate.disagreement !== undefined) {
    refuse(
      `${slate.disagreement} The cut will not run while the container and the record disagree about ` +
        `which set is condemned — a graveyard records the set that was IDENTIFIED, and cutting here ` +
        `would let the two readings differ in a durable record.`,
    );
  }

  // §27.7's guard: an unreachable wall could hold a member outside the sweep.
  const walls = unreachableStoreReport(gw);
  if (walls.faults.length > 0) {
    refuse(
      `the resolved container table names a wall this sweep cannot reach. ` +
        `${walls.faults.length} fault(s):\n  ${walls.faults.join("\n  ")}\n  ` +
        `Attach the container(s) (openContainer), or detach() them onto the record, then re-run.`,
    );
  }

  // A `kept` wall whose admit-set INTERSECTS the condemned set refuses the cut. This is the hole
  // Correction 2 closes for every other wall: `unreachableStoreReport` returns a wall as a FAULT only
  // while it is neither attached nor covered, and the documented remedy for a blocked erase —
  // detach() it onto the record — converts that fault into a footnote. The cut would then run,
  // reach the attached pools only, and report `holds: false` beside a `kept` list while members sat
  // legible on a shelf: H7 in the one artifact whose entire purpose is not being H7. The
  // intersection is COMPUTABLE without attaching anything (the wall's at-rest membership Term is in
  // the container table), so it is computed.
  const table = readContainerTable(gw.reactor, gw.validityNow(), operator);
  const accepted = new Set(slate.acceptsIncomplete);
  const notReached: { wall: string; acceptsIncomplete: string }[] = [];
  for (const wall of walls.kept) {
    if (accepted.has(wall)) {
      notReached.push({ wall, acceptsIncomplete: slate.record });
      continue;
    }
    const rec = table.containers.get(wall);
    const term = rec?.membership ?? readTermAt(gw.reactor, rec?.membershipAt);
    if (term === undefined) {
      refuse(
        `the kept wall "${wall}" declares no at-rest membership Term, so what it was seeded to ` +
          `admit cannot be computed — an uncomputable intersection with the condemned set cannot ` +
          `be excluded, and H9's direction is to fail closed rather than assume empty. Attach it ` +
          `(openContainer) and re-run, declare its membership, or name it in the slate's ` +
          `\`accepts-incomplete\` to cut around it on the record.`,
      );
    }
    const admits = gw.select(term).filter((d) => slate.members.has(d.id));
    if (admits.length > 0) {
      refuse(
        `the kept wall "${wall}" was seeded to admit ${admits.length} condemned delta(s) — ` +
          `${admits.map((d) => d.id).join(", ")} — and a detach record takes it out of this sweep. ` +
          `A per-member \`holds: false\` beside a \`kept\` list would report a completeness this ` +
          `cut cannot prove. Attach the wall (openContainer) and re-run, narrow the slate to ` +
          `exclude those ids (un-slating is free), or sign \`accepts-incomplete\` for this wall.`,
      );
    }
  }

  // A MEMBER THAT IS ANOTHER STANDING SLATE'S PINNED TERM would make that slate UNRESOLVED the moment
  // this cut landed — one cut silently disarming another slate's closures, on a door, with nothing
  // reporting it. Refused here rather than tolerated downstream, and `eraseImpl` refuses the same
  // delta for the same reason, which together is what keeps `unresolved` unreachable through a door.
  for (const other of readSlates(gw.reactor, gw.validityNow(), operator, now)) {
    if (other.record === slate.record) continue;
    if (slate.members.has(other.membershipAt)) {
      refuse(
        `the frozen member ${other.membershipAt} is the PINNED membership Term of the standing slate ` +
          `over "${other.container}". Erasing it would leave that slate unable to read its own ` +
          `condemned set, so its closures would silently stop enforcing. Cut or negate that slate ` +
          `first, or narrow this one to exclude that id (un-slating is free, §29.8).`,
      );
    }
  }

  // RE-FREEZE AGREEMENT, proven again: §29.2's door check proves it at declaration time, and the
  // window is exactly where the ground moves. Computed over the RECORD's pins, so nothing a later
  // container declaration did can move what is checked here. The ONE lawful exception is named rather
  // than discovered — an operator erasing a member BY HAND mid-window shrinks the evaluation while the
  // frozen id set survives, and refusing without an exception would only DETECT a jam nothing can
  // repair (nothing can un-erase, so the slate would stand with `read` closing forever).
  const frozen = readFrozenTerm(gw.reactor, slate.membershipAt);
  if (!frozen.ok) refuse(frozen.why);
  const pinnedTerm = (frozen as { term: unknown }).term;
  const reFrozen = freezeAgreement(gw.reactor, pinnedTerm, slate.version);
  const present = new Set(evalMembership(gw.reactor, pinnedTerm).map((d) => d.id));
  const priorErasure: { member: string; erasure: string }[] = [];
  const tombs = standingErasures(gw.reactor, gw.validityNow(), operator);
  for (const id of [...slate.members].sort()) {
    if (present.has(id)) continue;
    const already = tombs.find((t) => erasureTarget(t.claims) === id);
    if (already === undefined) {
      refuse(
        `the frozen member ${id} resolves to nothing and carries NO surviving lawful erasure, so ` +
          `the re-freeze disagreement is not accounted for (${reFrozen ?? "the address still agrees"}). ` +
          `A cut must not stand over an unreported gap.`,
      );
    }
    priorErasure.push({ member: id, erasure: already!.id });
  }
  // The GROW leg. Content addressing makes it unreachable THROUGH THE TERM — the pinned address names
  // immutable bytes, so `evalMembership` over it can only ever return a subset of the ids read out of
  // it. The reachable widening vector was a container re-declaration, and that is refused above (at the
  // door) and reported by the reader; this stays as the fail-closed backstop for any future shape.
  for (const id of present) {
    if (!slate.members.has(id)) {
      refuse(
        `the membership Term now admits ${id}, which is not in the frozen version ${slate.version} ` +
          `— a slate's condemned set cannot GROW after identification`,
      );
    }
  }

  // The affected, resurfacing and duplicates sets are computed HERE, immediately before any purge:
  // afterwards the members are gone and every intersection reads empty. The frozen-membership
  // lesson applying a second time, one layer up.
  const reach = affectedContainers(gw, slate.members, slate.container);
  if (reach.unknown.length > 0) {
    refuse(
      `the scope of ${reach.unknown.length} container(s) could not be read, so their intersection ` +
        `with the condemned set cannot be excluded: ${reach.unknown.join(", ")}. A graveyard's ` +
        `affected set is DURABLE, and an undetermined entry would make it a guess.`,
    );
  }
  const affected = reach.affected;
  const resurfacing = resurfacingOf(gw.reactor, slate.members);
  const duplicates = duplicatesOf(gw, slate.members);

  // Per member, the ORDINARY erase — the cut mints no new fan-out. Erasure, purge, attached
  // pool/wall fan-out and the byte verdict all come from §11 unchanged; the only addition is one
  // optional `slate` pointer on each newly-minted erasure.
  const priorIds = new Set(priorErasure.map((p) => p.member));
  const members: CutMemberReport[] = [];
  const faults: string[] = [];
  for (const id of [...slate.members].sort()) {
    try {
      const outstanding = priorIds.has(id) ? await erasureOutstanding(gw, id) : true;
      if (outstanding) {
        const result = await eraseImpl(gw, id, {
          ...(slate.reason === undefined ? {} : { reason: slate.reason }),
          slate: container,
        });
        members.push({
          member: id,
          erasure: result.erasure,
          // The reused-erasure path can carry none; the sibling branch below already reads it the
          // same way, so a cut report cannot disagree with itself about the same receipt.
          spokenBy: result.spokenBy ?? "",
          tiers: await tierVerdicts(gw, id, notReached),
          citations: result.citations,
          citationTiers: result.citationTiers,
        });
      } else {
        const tomb = tombs.find((t) => erasureTarget(t.claims) === id)!;
        members.push({
          member: id,
          erasure: tomb.id,
          spokenBy: spokenByOf(tomb.claims) ?? "",
          tiers: await tierVerdicts(gw, id, notReached),
          citations: [],
          citationTiers: [],
        });
      }
    } catch (err) {
      faults.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (faults.length > 0) {
    // ANY fault: throw, and the slate STANDS. No graveyard lands, the declaration survives, every
    // closed door stays closed — so a partially-cut slate is still slated, still reviewable, and
    // RESUMABLE. T32's `drop refused: … the pool remains ATTACHED` discipline. A re-run mints no
    // second erasure (§11's anchor).
    throw new Error(
      `cut ${container} did not complete: ${faults.length} member(s) could not be erased, so the ` +
        `slate STANDS — its doors stay closed, its declaration still resolves, and the cut is ` +
        `RESUMABLE. No graveyard was recorded.\n  ${faults.join("\n  ")}\n` +
        `Resolve them and re-run; the re-run mints no second erasure.`,
    );
  }

  const cutAt = now;
  const closes = [...slate.closes].sort();
  // The graveyard lands FIRST. A re-run after a crash between the two steps finds the graveyard
  // already standing and simply strikes — exactly one graveyard, idempotent by construction.
  const existing = findGraveyard(gw.reactor, gw.validityNow(), operator, slate.record);
  const graveyard =
    existing ??
    signer.sign(
      withStamp(gw.stamp(operator), (t) =>
        graveyardClaims(
          {
            container,
            record: slate.record,
            version: slate.version,
            membershipAt: slate.membershipAt,
            memberCount: slate.members.size,
            opened: slate.requestedAt,
            cutAt,
            closes,
            affected,
            priorErasure,
          },
          operator,
          t,
        ),
      ),
    );
  if (existing === undefined) {
    await gw.append([graveyard]);
    await gw.flush();
  }
  // The injected hold the order rail drives (T33's `adoptionHold` idiom): a test holds the cut open
  // between the graveyard and the strike to prove the crash window lands exactly one graveyard.
  if (gw.cutHold !== undefined) await gw.cutHold();
  // The LAST ACT: drop the container by striking its declaration. A property container holds no
  // bytes of its own, so this purges nothing — dropping it is not the cut, it ends it.
  const declarations = survivingDeclarationIds(gw.reactor, gw.validityNow(), operator, container);
  if (declarations.length > 0) {
    await gw.append(
      declarations.map((id) =>
        signer.sign(withStamp(gw.stamp(operator), (t) => retractionOf(id, operator, t))),
      ),
    );
  }

  return {
    slate: container,
    record: slate.record,
    graveyard: graveyard.id,
    version: slate.version,
    memberCount: slate.members.size,
    requestedBy: slate.requestedBy,
    requestedByForm: slate.requestedByForm,
    requestedAt: slate.requestedAt,
    deadline: slate.deadline,
    ...(slate.reason === undefined ? {} : { reason: slate.reason }),
    closes,
    window: { opened: slate.requestedAt, cutAt },
    members,
    priorErasure,
    notReached,
    affected,
    resurfacing,
    duplicates,
    observationOnly: OBSERVATION_FIELDS,
  };
}

// A wall's at-rest membership Term, for the `kept`-wall intersection. A wall's scope is an ORDINARY
// live Term, so the extensional requirement a slate's own membership carries does not apply — only
// "did it resolve at all", and an unresolved one is refused by the caller (H9, never assumed empty).
const readTermAt = (reactor: Reactor, membershipAt: string | undefined): unknown => {
  if (membershipAt === undefined) return undefined;
  const published = reactor.get(membershipAt);
  if (published === undefined) return undefined;
  const raw = primitives(published.claims, "term")[0];
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const spokenByOf = (claims: Claims): string | undefined => {
  const p = claims.pointers.find((x) => x.role === "spoken-by");
  return p?.target.kind === "primitive" && typeof p.target.value === "string"
    ? p.target.value
    : undefined;
};

// The per-tier byte verdict, asked of the BYTES and tri-state. A tier that cannot answer is
// `unproven`, never `false` — and a `kept` wall the operator signed `accepts-incomplete` over is
// `unproven` too, because nobody looked.
async function tierVerdicts(
  gw: Gateway,
  id: string,
  notReached: readonly { readonly wall: string }[],
): Promise<TierVerdict[]> {
  const out: TierVerdict[] = [];
  for (const { tier, gw: g } of reachableTiers(gw)) {
    try {
      out.push({ tier, holds: await g.backend.holds(id) });
    } catch {
      out.push({ tier, holds: "unproven" }); // proven nothing (H9), never proven clean
    }
  }
  for (const wall of notReached) out.push({ tier: wall.wall, holds: "unproven" });
  return out;
}

function findGraveyard(
  reactor: Reactor,
  now: number,
  operator: string,
  record: string,
): Delta | undefined {
  const negated = negatedAt(reactor, now, operator);
  // A HISTORY read: a graveyard records an erasure event, and erasure is eternal. Its own validity
  // window never retires it; only the operator's negation does.
  for (const d of lawfulHistory(reactor, operator)) {
    if (negated(d.id) || !isGraveyard(d.claims)) continue;
    const cited = d.claims.pointers.find(
      (p) => p.role === "slate-record" && p.target.kind === "delta",
    );
    if (cited?.target.kind === "delta" && cited.target.deltaRef.delta === record) return d;
  }
  return undefined;
}

// --- the graveyard: durable, joinable, arithmetic ------------------------------------------------

export interface CompletenessCheck {
  /**
   * §29.6's sentence, UNQUALIFIED: every member has a SURVIVING covering erasure. A later
   * negation makes this false, because a struck erasure stops surviving — that is the sentence
   * being read honestly, not a defect.
   */
  readonly holds: boolean;
  /**
   * Did the CUT complete? Every member accounted for as either a surviving covering erasure or an
   * ENUMERATED negation. This is the question a receipt asks, and it is a different one from
   * `holds`: collapsing the two would make the first lawful negation indistinguishable from an
   * abandoned cut — the same boolean collapse this file refuses for `ByteVerdict`, one layer up.
   */
  readonly cutCompleted: boolean;
  /** Could the frozen set be READ at all? False makes every other field vacuous rather than clean. */
  readonly readable: boolean;
  /** Why not, when `readable` is false — never silence (H9). */
  readonly unreadable?: string;
  readonly members: readonly string[];
  /** Members whose erasure neither cites this slate nor is named in `prior-erasure`. */
  readonly missing: readonly string[];
  /** Members whose erasure has since been lawfully STRUCK — reported, never subtracted. */
  readonly negated: readonly { readonly member: string; readonly negation: string }[];
}

/**
 * §29.6's arithmetic, read AT A NAMED MOMENT from DURABLE GROUND ALONE — no probe, no CutReport:
 *
 * > Every member of the frozen `version` has a surviving erasure, and that erasure either cites
 * > this slate or is named for that member in the graveyard's `prior-erasure` list.
 *
 * The clause after the comma is not a weakening: without it the proof is FALSE on cuts that
 * SUCCEEDED (a member erased by hand mid-window; a re-run anchoring on an erasure minted before
 * the `slate` pointer had a value to carry, which content addressing forbids adding later — H4).
 * A proof that cannot tell success from abandonment proves nothing, so the exception is ENUMERATED
 * in the graveyard rather than inferred at check time.
 *
 * And a NEGATED member does not falsify it either: §29.8 makes negation an erasure strike, so
 * the first lawful negation would flip a naive reading to FALSE. A member whose erasure has
 * been struck is reported as negated WITH its strike id. The graveyard records an event that
 * happened; negation is a later event, and the check reports both rather than subtracting one.
 */
export function graveyardCompleteness(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  graveyardId: string,
): CompletenessCheck {
  const blank = { holds: false, cutCompleted: false, members: [], missing: [], negated: [] };
  const grave = readGraveyards(reactor, now, operator).find((g) => g.id === graveyardId);
  if (grave === undefined || operator === undefined) {
    return {
      ...blank,
      readable: false,
      unreadable: `no surviving lawful graveyard at ${graveyardId}`,
    };
  }
  // AN UNREADABLE FROZEN SET IS NOT A CLEAN ONE. `members.length > 0` inside `holds` used to stand in
  // for this, which is the H7 shape wearing a guard clause: erase the membership Term after a cut and
  // the walk finds no ids, so "every member is accounted for" would be vacuously true over a set the
  // store can no longer read. The verdict is its own field, and it fails closed.
  const frozen = readFrozenTerm(reactor, grave.membershipAt);
  if (!frozen.ok) return { ...blank, readable: false, unreadable: frozen.why };
  const members = [...frozen.ids].sort();
  const prior = new Map(grave.priorErasure.map((p) => [p.member, p.erasure]));
  const surviving = new Map(
    standingErasures(reactor, now, operator).map((t) => [erasureTarget(t.claims)!, t]),
  );
  const witnesses = operatorStrikes(reactor, now, operator);
  const missing: string[] = [];
  const negated: { member: string; negation: string }[] = [];
  for (const member of members) {
    const tomb = surviving.get(member);
    if (tomb !== undefined) {
      const cites = at(tomb.claims, "slate", CTX_SLATE) === grave.container;
      if (cites || prior.get(member) === tomb.id) continue;
      missing.push(member);
      continue;
    }
    // No SURVIVING erasure. Struck (negated) is reported as itself; absent is a real hole.
    const strike = strikeOf(reactor, now, operator, witnesses, member);
    if (strike !== undefined) negated.push({ member, negation: strike });
    else missing.push(member);
  }
  return {
    // Two verdicts, because one boolean cannot hold both facts. `holds` is §29.6's sentence read
    // literally (a negation makes it false); `cutCompleted` is what a receipt asks (nothing
    // unexplained). An empty member set answers NEITHER affirmatively — `readable` decides that.
    holds: missing.length === 0 && negated.length === 0,
    cutCompleted: missing.length === 0,
    readable: true,
    members,
    missing,
    negated,
  };
}

// The lawful negation of a member's erasure — the id a receipt reports beside NEGATED. It must be a
// negation that holds at `now`: an erasure can carry an older negation that was itself negated, or
// one whose own validity has not begun or has ended. The witnesses are exactly the strikes that
// decide "negated", so the id reported cannot disagree with the verdict.
function strikeOf(
  reactor: Reactor,
  now: number,
  operator: string,
  witnesses: (id: string) => readonly Delta[],
  member: string,
): string | undefined {
  // A HISTORY read: an erasure keeps counting after its own validity window, as `boundErasures`
  // reads it. Only the strike must hold at `now`.
  for (const d of lawfulHistory(reactor, operator)) {
    if (!isErasure(d.claims) || erasureTarget(d.claims) !== member) continue;
    const strike = witnesses(d.id)[0];
    if (strike !== undefined) return strike.id;
  }
  return undefined;
}

const operatorStrikes = (reactor: Reactor, now: number, operator: string) =>
  reactor.negationWitnesses(now, (n) => n.claims.author === operator);

// Every tier a sweep did NOT examine — covered walls and unreachable ones alike. One reader, so the
// cut's refusal and the receipt's confession can never disagree about which tiers were skipped.
const unreachedTiers = (walls: {
  kept: readonly string[];
  faultEntities: readonly string[];
}): { wall: string }[] => [...walls.kept, ...walls.faultEntities].map((wall) => ({ wall }));

// --- the receipt (the structured half; the signed DOCUMENT is §29.7's deferred half) -------------

export interface ReceiptMember {
  readonly member: string;
  /** The SURVIVING erasure, when one stands. */
  readonly erasure?: string;
  /** The strike that forgave it (§29.8) — present instead of `erasure` after a negation. */
  readonly negated?: string;
  /**
   * Is the id PRESENT in the ground again? One `get(id)` answers it. A negated erasure never lets
   * the id back in (§11), so this is true only while a purge has left the bytes behind.
   */
  readonly presentAgain: boolean;
  /** RE-PROBED at `issuedAt`, never reprinted from the CutReport. */
  readonly tiers: readonly TierVerdict[];
  readonly citations: readonly string[];
  /** The citations manifest attributed per tier (T216) — see `CitationTier`. */
  readonly citationTiers: readonly CitationTier[];
}

export interface Receipt {
  readonly issuedAt: number;
  readonly graveyard: string;
  readonly slate: string;
  readonly record: string;
  readonly version: string;
  readonly memberCount: number;
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  readonly window: { readonly opened: number; readonly cutAt: number };
  readonly closes: readonly SlateClosure[];
  readonly members: readonly ReceiptMember[];
  readonly priorErasure: readonly { readonly member: string; readonly erasure: string }[];
  readonly completeness: CompletenessCheck;
  /** What this document does NOT claim. Printed beside the verdicts, never as a footnote. */
  readonly nonClaim: readonly string[];
}

/**
 * Re-derive a receipt from the graveyard + the erasures + the frozen version, plus a LIVE PROBE
 * at the moment of issue. Re-issuable at any time, which is exactly §11's testable-compliance
 * promise. The byte verdicts are RE-PROBED here every time: reading them from a CutReport would be
 * the dry-run mistake this whole design rejects, wearing a letterhead.
 */
export async function deriveReceiptImpl(
  gw: Gateway,
  graveyardId: string,
  opts: { now?: number } = {},
): Promise<Receipt> {
  const operator = gw.operatorAuthor;
  const grave = readGraveyards(gw.reactor, gw.validityNow(), operator).find(
    (g) => g.id === graveyardId,
  );
  if (grave === undefined) {
    throw new Error(`no surviving lawful graveyard is held here at ${graveyardId}`);
  }
  const issuedAt = opts.now ?? Date.now();
  const request = gw.reactor.get(grave.record);
  const completeness = graveyardCompleteness(gw.reactor, gw.validityNow(), operator, graveyardId);
  const witnesses = operatorStrikes(gw.reactor, gw.validityNow(), operator!);
  const surviving = new Map(
    standingErasures(gw.reactor, gw.validityNow(), operator).map((t) => [
      erasureTarget(t.claims)!,
      t,
    ]),
  );
  const walls = unreachableStoreReport(gw);
  const members: ReceiptMember[] = [];
  for (const member of completeness.members) {
    const tomb = surviving.get(member);
    const strike =
      tomb === undefined
        ? strikeOf(gw.reactor, gw.validityNow(), operator!, witnesses, member)
        : undefined;
    // The manifest walks the SAME tier set the byte verdict does (T216) — primary plus every attached
    // pool — so a surviving pool-resident dangler (a T207 arrival stamp echoing the erased member) is
    // named rather than omitted. No exclusion: at re-issue the erasure genuinely dangles at the hole
    // and belongs in the manifest, exactly as before this widened past the primary.
    const dangling = danglingCitations(gw, member);
    members.push({
      member,
      ...(tomb === undefined ? {} : { erasure: tomb.id }),
      ...(strike === undefined ? {} : { negated: strike }),
      presentAgain: gw.reactor.get(member) !== undefined,
      // BOTH halves of the wall report, and the sets are DISJOINT: `kept` is covered by a detach
      // record, `faults` is neither attached nor covered — a wall nobody re-attached after a restart.
      // Reading only `kept` made a faulted tier appear NOWHERE, which reads as "not a tier" rather
      // than `unproven` (H9). `cutImpl` refuses on faults; a RE-ISSUE cannot refuse, so it confesses.
      tiers: await tierVerdicts(gw, member, unreachedTiers(walls)),
      citations: dangling.citations,
      citationTiers: dangling.citationTiers,
    });
  }
  return {
    issuedAt,
    graveyard: grave.id,
    slate: grave.container,
    record: grave.record,
    version: grave.version,
    memberCount: grave.memberCount,
    requestedBy:
      request === undefined
        ? ""
        : ((primitives(request.claims, "requested-by")[0] as string) ?? ""),
    requestedByForm:
      request === undefined
        ? "plain"
        : ((primitives(request.claims, "requested-by-form")[0] as "plain" | "sealed") ?? "plain"),
    window: { opened: grave.opened, cutAt: grave.cutAt },
    closes: grave.closes,
    members,
    priorErasure: grave.priorErasure,
    completeness,
    nonClaim: [
      // The ESM registry is a tier the byte probes cannot ask — the standing R1 violation's
      // honesty half (T105 a). Same constant health() reads, so the two surfaces cannot drift.
      ...ESM_RESIDENCY_DISCLOSURE,

      // The limits that hold for ANY erasure, single-delta or cut, from the SAME constant the
      // terminal's `loam erase` prints — so a compliance officer reading a receipt and one reading
      // a run cannot be told different things about where the promise stops.
      ...ERASURE_NON_CLAIMS,
      ...walls.kept.map(
        (wall) =>
          `A KEPT WALL WAS NOT SWEPT: "${wall}" is covered by a detach record, its per-member ` +
          `verdict reads \`unproven\` rather than \`false\`, and nobody looked inside it.`,
      ),
      ...walls.faultEntities.map(
        (wall) =>
          `A DECLARED WALL COULD NOT BE REACHED: "${wall}" is neither attached nor covered by a ` +
          `detach record, so its store was not examined at all and its per-member verdict reads ` +
          `\`unproven\`. Attach it (openContainer) and re-issue to replace this with a real verdict.`,
      ),
      "A RESTORED BACKUP CAN RESURFACE BYTES, and this document is RE-ISSUABLE to prove present " +
        "state — every per-tier verdict above was probed at the issue moment, never reprinted.",
      // The unswept §36 home surfaces (T131), from the SAME constant `health()` reads — so the receipt
      // and the live report cannot drift on what erasure does not reach. Without these two lines the
      // list reads as exhaustive while a forgotten user's password hash still sits in credentials.json.
      ...UNSWEPT_AUTH_SURFACES,
    ],
  };
}
