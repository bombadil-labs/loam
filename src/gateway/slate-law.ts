import {
  evalTermRaw,
  parseTerm,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "./container-identity.js";
import { CTX_CONTAINER, readContainerTable } from "./container-law.js";
import { isErasure, erasedFromReading, standingErasures, erasureTarget } from "./erase-law.js";
import { withNegationClosure } from "./negation-closure.js";
import { lawfulDeltasAt, lawfulHistory } from "./lawful.js";
import { negatedAt } from "./negation.js";
import { governedProgram } from "./governed-trust.js";
import { userGroundOf } from "./user-root.js";
import { hasMemberOf } from "./member-of.js";
import { CTX_SLATE } from "./slate-vocab.js";
import type { Ground } from "./ground.js";

export const SLATE_ENTITY = "loam:slate";

const SLATE_AT = { entity: SLATE_ENTITY, context: CTX_SLATE } as const;

export const CTX_GRAVEYARD = "loam.erasure.graveyard";

export type SlateClosure = "egress" | "cite" | "read";

export const CLOSURES = new Set<string>(["egress", "cite", "read"]);

export const RECOMMENDED_CLOSES = "egress,cite";

export const PRIMITIVE_DELTA_REF_ROLES = ["source-delta"] as const;

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

const RETIRED_SLATE_ENTITY = "loam:erasure";

export const isRetiredSlateFormat = (claims: Claims): boolean =>
  [CTX_SLATE, CTX_GRAVEYARD].some(
    (context) => at(claims, "declares", context) === RETIRED_SLATE_ENTITY,
  );

export function slateDefect(
  delta: Delta,
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): string | undefined {
  const claims = delta.claims;
  if (isRetiredSlateFormat(claims))
    return `a slate or graveyard record declares ${RETIRED_SLATE_ENTITY}, its retired format; it declares ${SLATE_ENTITY} now`;
  if (isGraveyard(claims)) return graveyardDefect(claims, operator);
  if (!isSlateRecord(claims)) return undefined;
  const shape = slateShapeDefect(claims, operator);
  if (shape !== undefined) return shape;
  return slateStateDefect(claims, reactor, now, operator!);
}

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

function slateStateDefect(
  claims: Claims,
  reactor: Reactor,
  now: number,
  operator: string,
): string | undefined {
  const container = at(claims, "slate", CTX_SLATE)!;
  const pinned = pinsOf(claims)!;
  const frozen = readFrozenTerm(reactor, pinned.membershipAt);
  if (!frozen.ok) return `slate "${container}": ${frozen.why} (H9: the record fails closed)`;
  const agreed = freezeAgreement(reactor, frozen.term, pinned.version);
  if (agreed !== undefined) return `slate "${container}": ${agreed}`;
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
  if (rec === undefined) return undefined;
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

function pinsOf(claims: Claims): { membershipAt: string; version: string } | undefined {
  const membershipAt = primitives(claims, "membershipAt")[0];
  const version = primitives(claims, "version")[0];
  if (typeof membershipAt !== "string" || typeof version !== "string") return undefined;
  return { membershipAt, version };
}

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

export type FrozenTerm =
  | { readonly ok: true; readonly term: unknown; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly why: string };

export function readFrozenTerm(reactor: Ground, membershipAt: string): FrozenTerm {
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

export function freezeAgreement(
  reactor: Reactor,
  term: unknown,
  version: string,
): string | undefined {
  let evaluated: string;
  try {
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

export function evalMembership(reactor: Reactor, term: unknown): Delta[] {
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

export interface Slate {
  readonly record: string;
  readonly container: string;
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  readonly requestedAt: number;
  readonly deadline: number;
  readonly reason?: string;
  readonly acceptsIncomplete: readonly string[];
  readonly declared: readonly SlateClosure[];
  readonly closes: ReadonlySet<SlateClosure>;
  readonly lapsed: boolean;
  readonly members: ReadonlySet<string>;
  readonly version: string;
  readonly membershipAt: string;
  readonly unresolved?: string;

  readonly disagreement?: string;
}

export function readSlates(
  reactor: Reactor,
  validityNow: number,
  operator: string | undefined,
  now: number,
): Slate[] {
  if (operator === undefined) return [];
  requireMoment(now, "readSlates");
  const records = lawfulDeltasAt(reactor, validityNow, SLATE_AT, operator).filter((d) =>
    isSlateRecord(d.claims),
  );
  if (records.length === 0) return [];

  const negated = negatedAt(reactor, validityNow, operator);
  const table = readContainerTable(reactor, validityNow, operator);
  const out: Slate[] = [];
  for (const delta of records) {
    if (negated(delta.id)) continue;
    if (slateShapeDefect(delta.claims, operator) !== undefined) continue;
    const claims = delta.claims;
    const container = at(claims, "slate", CTX_SLATE)!;
    const pinned = pinsOf(claims)!;
    const rec = table.containers.get(container);
    const declaredRaw = primitives(claims, "closes").filter(
      (c): c is SlateClosure => typeof c === "string" && CLOSURES.has(c),
    );
    const declared = [...new Set(declaredRaw)];
    const deadline = primitives(claims, "deadline")[0] as number;
    const lapsed = now > deadline;
    const closes = new Set<SlateClosure>(declared);
    if (lapsed) closes.add("read");
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
      membershipAt: pinned.membershipAt,
      version: pinned.version,
    };
    if (rec === undefined) continue;
    const frozen = readFrozenTerm(reactor, pinned.membershipAt);
    if (!frozen.ok) {
      out.push({ ...base, members: new Set(), unresolved: frozen.why });
      continue;
    }
    const disagreement = containerDisagreement(rec, pinned);
    if (disagreement !== undefined) {
      out.push({ ...base, members: frozen.ids, disagreement });
      continue;
    }
    out.push({ ...base, members: frozen.ids });
  }
  out.sort((a, b) => (a.record < b.record ? -1 : a.record > b.record ? 1 : 0));
  return out;
}

export function requireMoment(now: number, what: string): void {
  if (typeof now !== "number" || !Number.isFinite(now)) {
    throw new Error(
      `${what} refused: no moment was passed. A slate's lapse is computed AT THE DOOR, so every ` +
        `door that honours \`read\` needs the caller's WALL-CLOCK \`now\` — a missing moment is a ` +
        `programming error that fails closed, never a read that quietly ignores a lapsed deadline.`,
    );
  }
}

export function slateRefusal(
  slates: readonly Slate[],
  delta: Delta,
): { container: string; member: string } | undefined {
  const claims = delta.claims;
  if (isErasure(claims) || isGraveyard(claims)) return undefined;
  for (const slate of slates) {
    if (!slate.closes.has("cite") || slate.members.size === 0) continue;
    for (const p of claims.pointers) {
      if (p.role === "negates") continue;
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

export interface SlateGround {
  readonly reactor: Reactor;
  readonly operatorAuthor: string | undefined;
  validityNow(): number;
}

export interface SlateHealth {
  readonly open: number;
  readonly lapsed: number;
  readonly lapsedIds: readonly string[];

  readonly unresolved: readonly string[];
  readonly disagreeing: readonly string[];
}

export interface NegatedHealth {
  readonly count: number;
  readonly present: number;
  readonly ids: readonly string[];

  readonly unreadable: readonly string[];
}

export function slateHealth(ground: SlateGround, now: number): SlateHealth {
  const slates = readSlates(ground.reactor, ground.validityNow(), ground.operatorAuthor, now);
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

export function condemnedClosure(reactor: Ground, seed: Iterable<string>): Set<string> {
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

const closureIds = (reactor: Ground, slates: readonly Slate[], door: SlateClosure): Set<string> => {
  const seed = new Set<string>();
  for (const s of slates) {
    if (!s.closes.has(door)) continue;
    for (const id of s.members) seed.add(id);
  }
  return seed.size === 0 ? seed : condemnedClosure(reactor, seed);
};

export function egressWithheld(ground: SlateGround, now: number): Set<string> {
  return closureIds(
    ground.reactor,
    readSlates(ground.reactor, ground.validityNow(), ground.operatorAuthor, now),
    "egress",
  );
}

export function readClosedIds(ground: SlateGround, now: number): Set<string> {
  requireMoment(now, "a read door");
  const closed = closureIds(
    ground.reactor,
    readSlates(ground.reactor, ground.validityNow(), ground.operatorAuthor, now),
    "read",
  );
  for (const id of erasedFromReading(ground.reactor, ground.operatorAuthor)) closed.add(id);
  return closed;
}

export function landsReadClosure(
  ground: SlateGround,
  fresh: readonly Delta[],
  now: number,
): boolean {
  if (fresh.some((d) => isSlateRecord(d.claims))) return readClosedIds(ground, now).size > 0;
  return fresh.some((d) => {
    if (!isErasure(d.claims)) return false;
    const target = erasureTarget(d.claims);
    return target !== undefined && ground.reactor.get(target) !== undefined;
  });
}

export interface GraveyardRecord {
  readonly id: string;
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

export function readGraveyards(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): GraveyardRecord[] {
  if (operator === undefined) return [];
  const negated = negatedAt(reactor, now, operator);
  const out: GraveyardRecord[] = [];
  for (const d of lawfulHistory(reactor, operator)) {
    if (negated(d.id) || !isGraveyard(d.claims)) continue;
    if (graveyardDefect(d.claims, operator) !== undefined) continue;
    const cited = d.claims.pointers.find(
      (p) => p.role === "slate-record" && p.target.kind === "delta",
    );
    out.push({
      id: d.id,
      container: at(d.claims, "graveyard", CTX_GRAVEYARD)!,
      record: cited?.target.kind === "delta" ? cited.target.deltaRef.delta : "",
      version: primitives(d.claims, "version")[0] as string,
      membershipAt: primitives(d.claims, "membershipAt")[0] as string,
      memberCount: primitives(d.claims, "member-count")[0] as number,
      opened: primitives(d.claims, "opened")[0] as number,
      cutAt: primitives(d.claims, "cut-at")[0] as number,
      closes: primitives(d.claims, "closes").filter(
        (c): c is SlateClosure => typeof c === "string" && CLOSURES.has(c),
      ),
      affected: entitiesAt(d.claims, "affected", CTX_CONTAINER),
      priorErasure: primitives(d.claims, "prior-erasure")
        .map((p) => (typeof p === "string" ? parsePriorPair(p) : undefined))
        .filter((p): p is { member: string; erasure: string } => p !== undefined),
    });
  }
  out.sort((a, b) => a.cutAt - b.cutAt || (a.id < b.id ? -1 : 1));
  return out;
}

export function negatedHealth(ground: SlateGround): NegatedHealth {
  const operator = ground.operatorAuthor;
  const empty = { count: 0, present: 0, ids: [], unreadable: [] };
  if (operator === undefined) return empty;
  const graves = readGraveyards(ground.reactor, ground.validityNow(), operator);
  if (graves.length === 0) return empty;
  const surviving = new Set(
    standingErasures(ground.reactor, ground.validityNow(), operator).map((t) =>
      erasureTarget(t.claims)!,
    ),
  );
  const ids = new Set<string>();
  const unreadable: string[] = [];
  for (const grave of graves) {
    const frozen = readFrozenTerm(ground.reactor, grave.membershipAt);
    if (!frozen.ok) {
      unreadable.push(grave.id);
      continue;
    }
    for (const id of frozen.ids) if (!surviving.has(id)) ids.add(id);
  }
  const sorted = [...ids].sort();
  return {
    count: sorted.length,
    present: sorted.filter((id) => ground.reactor.get(id) !== undefined).length,
    ids: sorted,
    unreadable: unreadable.sort(),
  };
}
