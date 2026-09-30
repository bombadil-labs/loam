// Slates' pure law: the vocabulary, the record's shape, and the readers of what a standing slate
// withholds. Nothing here cuts, purges or reaches a pool; that is `slate.ts`. Kept free of the
// gateway so its readers can import it without joining the gateway's import cycle.

import {
  evalTermRaw,
  parseTerm,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "./container-identity.js";
import { CTX_CONTAINER, readContainerTable } from "./container-law.js";
import { isErasure } from "./erase-law.js";
import { withNegationClosure } from "./negation-closure.js";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import { governedProgram } from "./governed-trust.js";
import { userGroundOf } from "./user-root.js";
import { hasMemberOf } from "./member-of.js";
import { CTX_SLATE } from "./slate-vocab.js";

/**
 * The entity both new records DECLARE — the marker that tells a slate record and a graveyard apart
 * from anything else wearing a `slate` pointer. It has to be a declaration and not the role alone:
 * every erasure a cut mints carries `{role: "slate", …}` as §29.6's JOIN, so a reader keyed on
 * that role would read each of its own erasures as a malformed slate record and jam the cut at its
 * second member. The same shape `isErasure` uses, for the same reason.
 */
export const SLATE_ENTITY = "loam:erasure";

const SLATE_AT = { entity: SLATE_ENTITY, context: CTX_SLATE } as const;

export const CTX_GRAVEYARD = "loam.erasure.graveyard";

/** The three doors a slate may close (§29.3). `none` is sayable and means the empty set. */
export type SlateClosure = "egress" | "cite" | "read";

export const CLOSURES = new Set<string>(["egress", "cite", "read"]);

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

// --- shape readers -------------------------------------------------------------------------------

export const at = (claims: Claims, role: string, context: string): string | undefined => {
  const p = claims.pointers.find(
    (x) => x.role === role && x.target.kind === "entity" && x.target.entity.context === context,
  );
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

export const primitives = (claims: Claims, role: string): (string | number | boolean)[] =>
  claims.pointers
    .filter((p) => p.role === role && p.target.kind === "primitive")
    .map((p) => (p.target as { value: string | number | boolean }).value);

export const entitiesAt = (claims: Claims, role: string, context: string): string[] =>
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
  now: number,
  operator: string | undefined,
): string | undefined {
  const claims = delta.claims;
  if (isGraveyard(claims)) return graveyardDefect(claims, operator);
  if (!isSlateRecord(claims)) return undefined;
  const shape = slateShapeDefect(claims, operator);
  if (shape !== undefined) return shape;
  return slateStateDefect(claims, reactor, now, operator!);
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
function slateStateDefect(
  claims: Claims,
  reactor: Reactor,
  now: number,
  operator: string,
): string | undefined {
  const container = at(claims, "slate", CTX_SLATE)!;
  const pinned = pinsOf(claims)!; // the shape check proved both present
  // The PINNED Term must be published, extensional, and freeze to the PINNED version. All three read
  // the record's own pointers, never the container's, so nothing a later declaration does can move
  // what this door certified.
  const frozen = readFrozenTerm(reactor, pinned.membershipAt);
  if (!frozen.ok) return `slate "${container}": ${frozen.why} (H9: the record fails closed)`;
  const agreed = freezeAgreement(reactor, frozen.term, pinned.version);
  if (agreed !== undefined) return `slate "${container}": ${agreed}`;
  // A protected local channel event is never slated (spec 64): the slate's cite closure would
  // refuse the drop's own close event, and the cut would fault on the live opening forever. The
  // road for a channel is drop, then erase.
  for (const id of extensionalIds(frozen.term) ?? []) {
    const member = reactor.get(id);
    if (
      member !== undefined &&
      member.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          (p.target.entity.context === "loam.local.channel.event" ||
            p.target.entity.context === "loam.local.channel.control"),
      )
    )
      return (
        `slate "${container}" condemns ${id}, a protected local channel record. A channel is ` +
        `never slated: drop it (dropChannel), then erase what its history left.`
      );
  }

  const table = readContainerTable(reactor, now, operator);
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
    `fixed at identification and cannot be re-pointed underneath it — negate the record and file a ` +
    `new one to condemn a different set (un-slating is free, §29.8).`
  );
}

export function graveyardDefect(claims: Claims, operator: string | undefined): string | undefined {
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
  for (const pair of primitives(claims, "prior-erasure")) {
    if (typeof pair !== "string" || parsePriorPair(pair) === undefined) {
      return "a graveyard's prior-erasure entries are JSON [memberId, erasureId] pairs";
    }
  }
  return undefined;
}

export const parsePriorPair = (raw: string): { member: string; erasure: string } | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [member, erasure] = parsed as unknown[];
    if (typeof member !== "string" || typeof erasure !== "string") return undefined;
    return { member, erasure };
  } catch {
    return undefined;
  }
};

// --- the frozen membership -----------------------------------------------------------------------

/**
 * The published Term at a `membershipAt` address, plus the ids it names EXTENSIONALLY. The door
 * predicate needs NO SCAN: a frozen membership is `match{field: id, cmp: inSet}`, so the condemned
 * ids are literally the values in the published Term's JSON and a slated-id lookup is a `Set.has` —
 * the same cost class as the `readErasures` check that already runs at both doors (H8, answered).
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
export function evalMembership(reactor: Reactor, term: unknown): Delta[] {
  // A slate freezes its membership's result and checks it again later. A membership that follows a
  // user's current keys moves with them, so it cannot be frozen: refuse it by name.
  if (hasMemberOf(term)) {
    throw new Error(
      "a slate cannot freeze a membership that follows a user's keys (loam.memberOf)",
    );
  }
  const ground = reactor.snapshot();
  const program = governedProgram(
    parseTerm(term),
    undefined,
    ground,
    { raw: true },
    userGroundOf(reactor),
  );
  const result = evalTermRaw(program.term, ground);
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
 * Every surviving lawful slate, with each one's closure set resolved AT THE MOMENT `now`.
 *
 * The lapse is a READ-TIME VERDICT because nothing in Loam runs a timer and this design must not
 * pretend one exists: a slate whose `deadline` is past resolves with `read` added. That fails SAFE
 * (a store down for a week wakes with read already closed), needs no scheduler, and gives the rails
 * a deterministic seam — an explicit `now`, never a wall-clock race.
 *
 * `now` is WALL-CLOCK ms and is compared only against `deadline`, never against a delta's own
 * DELTA-TIME timestamp (a stamp's `timestamp` orders an author's claims and may run ahead).
 */
export function readSlates(
  reactor: Reactor,
  validityNow: number,
  operator: string | undefined,
  now: number,
): Slate[] {
  if (operator === undefined) return []; // an ungoverned store has no lawful voice, so no slates
  requireMoment(now, "readSlates");
  // The cheap existence probe first (the `deadSet` discipline, H8): a store holding no slate record
  // at all answers without paying for the negation materialization or the container table. It
  // decides nothing else — which records SURVIVE stays the one place below that owns the rule. A
  // slate record is filed at SLATE_ENTITY, so the target index answers it; `reactor.snapshot()`
  // would copy and walk the whole store on every read and every write.
  const records = lawfulDeltasAt(reactor, validityNow, SLATE_AT, operator).filter((d) =>
    isSlateRecord(d.claims),
  );
  if (records.length === 0) return [];

  const negated = negatedAt(reactor, validityNow, operator);
  const table = readContainerTable(reactor, validityNow, operator);
  const out: Slate[] = [];
  for (const delta of records) {
    if (negated(delta.id)) continue;
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
  // removal. An erasure names its target under `erases`, and the cut mints one per member; a
  // graveyard names the slate it closed. Refusing those would make a slate refuse its own cut.
  if (isErasure(claims) || isGraveyard(claims)) return undefined;
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
