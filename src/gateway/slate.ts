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
import type { Ground } from "./ground.js";

export const SLATE_CONTEXTS = [CTX_SLATE, CTX_GRAVEYARD] as const;
const primPtr = (role: string, value: string | number): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value },
});

export interface SlateSpec {
  readonly container: string;

  readonly membershipAt: string;
  readonly version: string;
  readonly requestedBy: string;
  readonly requestedByForm: "plain" | "sealed";
  readonly requestedAt: number;
  readonly deadline: number;
  readonly closes: readonly SlateClosure[];
  readonly reason?: string;
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
      ...spec.priorErasure.map((p) =>
        primPtr("prior-erasure", JSON.stringify([p.member, p.erasure])),
      ),
    ],
  };
}

export function frozenMembershipTerm(ids: readonly string[]): unknown {
  return {
    op: "select",
    pred: { match: { field: "id", cmp: "inSet", const: [...ids].sort() } },
    in: "input",
  };
}

export const enforcedBy = (slate: Slate): SlateClosure[] =>
  slate.unresolved !== undefined || slate.members.size === 0 ? [] : [...slate.closes].sort();

export interface Duplicate {
  readonly member: string;
  readonly record: string;
  readonly role: string;
}

export interface SlateReport extends Omit<Slate, "members" | "closes"> {
  readonly closes: readonly SlateClosure[];

  readonly enforced: readonly SlateClosure[];
  readonly members: readonly string[];
  readonly resurfacing: readonly string[];

  readonly affectedUnknown: readonly string[];
  readonly affected: readonly string[];

  readonly duplicates: readonly Duplicate[];
}

export function slateReportsImpl(gw: Gateway, now: number): SlateReport[] {
  const slates = readSlates(gw.reactor, gw.validityNow(), gw.operatorAuthor, now);
  if (slates.length === 0) return [];
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

function resurfacingOf(reactor: Ground, members: ReadonlySet<string>): string[] {
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

function affectedContainers(
  gw: Gateway,
  members: ReadonlySet<string>,
  self: string,
): { affected: string[]; unknown: string[] } {
  return affectedFor(gw, [{ members, container: self }])[0]!;
}

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

export function readGround(gw: Gateway, now: number): DeltaSet {
  return groundWithout(gw.reactor.snapshot(), readClosedIds(gw, now));
}

export function readGroundAsOf(gw: Gateway, asOfGround: DeltaSet, now: number): DeltaSet {
  return groundWithout(asOfGround, readClosedIds(gw, now));
}

const groundWithout = (ground: DeltaSet, closed: ReadonlySet<string>): DeltaSet =>
  closed.size === 0 ? ground : DeltaSet.from([...ground].filter((d) => !closed.has(d.id)));

export type ByteVerdict = false | true | "unproven";

export interface TierVerdict {
  readonly tier: string;
  readonly holds: ByteVerdict;
}

export interface CutMemberReport {
  readonly member: string;
  readonly erasure: string;
  readonly spokenBy: string;
  readonly tiers: readonly TierVerdict[];
  readonly citations: readonly string[];

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
  readonly priorErasure: readonly { readonly member: string; readonly erasure: string }[];
  readonly notReached: readonly { readonly wall: string; readonly acceptsIncomplete: string }[];
  readonly affected: readonly string[];
  readonly resurfacing: readonly string[];
  readonly duplicates: readonly Duplicate[];
  readonly observationOnly: readonly string[];
}

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

  const walls = unreachableStoreReport(gw);
  if (walls.faults.length > 0) {
    refuse(
      `the resolved container table names a wall this sweep cannot reach. ` +
        `${walls.faults.length} fault(s):\n  ${walls.faults.join("\n  ")}\n  ` +
        `Attach the container(s) (openContainer), or detach() them onto the record, then re-run.`,
    );
  }

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
  for (const id of present) {
    if (!slate.members.has(id)) {
      refuse(
        `the membership Term now admits ${id}, which is not in the frozen version ${slate.version} ` +
          `— a slate's condemned set cannot GROW after identification`,
      );
    }
  }

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
    throw new Error(
      `cut ${container} did not complete: ${faults.length} member(s) could not be erased, so the ` +
        `slate STANDS — its doors stay closed, its declaration still resolves, and the cut is ` +
        `RESUMABLE. No graveyard was recorded.\n  ${faults.join("\n  ")}\n` +
        `Resolve them and re-run; the re-run mints no second erasure.`,
    );
  }

  const cutAt = now;
  const closes = [...slate.closes].sort();
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
  if (gw.cutHold !== undefined) await gw.cutHold();
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

const readTermAt = (reactor: Ground, membershipAt: string | undefined): unknown => {
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

async function tierVerdicts(
  gw: Gateway,
  id: string,
  notReached: readonly { readonly wall: string }[],
): Promise<TierVerdict[]> {
  const out: TierVerdict[] = [];
  for (const { tier, gw: g } of reachableTiers(gw)) {
    try {
      out.push({ tier, holds: await g.probe({ holds: id }) });
    } catch {
      out.push({ tier, holds: "unproven" });
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
  for (const d of lawfulHistory(reactor, operator)) {
    if (negated(d.id) || !isGraveyard(d.claims)) continue;
    const cited = d.claims.pointers.find(
      (p) => p.role === "slate-record" && p.target.kind === "delta",
    );
    if (cited?.target.kind === "delta" && cited.target.deltaRef.delta === record) return d;
  }
  return undefined;
}

export interface CompletenessCheck {
  readonly holds: boolean;

  readonly cutCompleted: boolean;
  readonly readable: boolean;
  readonly unreadable?: string;
  readonly members: readonly string[];
  readonly missing: readonly string[];
  readonly negated: readonly { readonly member: string; readonly negation: string }[];
}

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
    const strike = strikeOf(reactor, now, operator, witnesses, member);
    if (strike !== undefined) negated.push({ member, negation: strike });
    else missing.push(member);
  }
  return {
    holds: missing.length === 0 && negated.length === 0,
    cutCompleted: missing.length === 0,
    readable: true,
    members,
    missing,
    negated,
  };
}

function strikeOf(
  reactor: Reactor,
  now: number,
  operator: string,
  witnesses: (id: string) => readonly Delta[],
  member: string,
): string | undefined {
  for (const d of lawfulHistory(reactor, operator)) {
    if (!isErasure(d.claims) || erasureTarget(d.claims) !== member) continue;
    const strike = witnesses(d.id)[0];
    if (strike !== undefined) return strike.id;
  }
  return undefined;
}

const operatorStrikes = (reactor: Ground, now: number, operator: string) =>
  reactor.negationWitnesses(now, (n) => n.claims.author === operator);

const unreachedTiers = (walls: {
  kept: readonly string[];
  faultEntities: readonly string[];
}): { wall: string }[] => [...walls.kept, ...walls.faultEntities].map((wall) => ({ wall }));

export interface ReceiptMember {
  readonly member: string;
  readonly erasure?: string;
  readonly negated?: string;

  readonly presentAgain: boolean;
  readonly tiers: readonly TierVerdict[];
  readonly citations: readonly string[];
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
  readonly nonClaim: readonly string[];
}

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
    const dangling = danglingCitations(gw, member);
    members.push({
      member,
      ...(tomb === undefined ? {} : { erasure: tomb.id }),
      ...(strike === undefined ? {} : { negated: strike }),
      presentAgain: gw.reactor.get(member) !== undefined,
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
      ...ESM_RESIDENCY_DISCLOSURE,

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
      ...UNSWEPT_AUTH_SURFACES,
    ],
  };
}
