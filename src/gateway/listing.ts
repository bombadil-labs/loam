import type { Signer } from "./signer.js";
import {
  evalPred,
  parseTerm,
  type Delta,
  type Pred,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";
import {
  containerClaims,
  isContainerLaw,
  readContainerTable,
  type ContainerTable,
} from "./container-law.js";
import { erasedInScope } from "./erase.js";
import { erasedFromReading } from "./erase-law.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";
import { programOf, type ProgramName } from "./registration.js";
import type { ResolvedNode } from "../surface/surface.js";
import { withStamp } from "./stamp.js";
import { USER_PREFIX } from "./user-root.js";
import { hasMemberOf, membershipForValidation } from "./member-of.js";
import { programMaskJson } from "./program-mask.js";
import { assertChannelSourceLegible } from "./reads.js";

export const LISTING_DEFAULT_LIMIT = 10;
export const LISTING_MAX_LIMIT = 25;

export interface ListOptions {
  readonly limit?: number;
  readonly after?: string | undefined;
}

export const listingContainerName = (program: string): string => `container:hyperschema:${program}`;

export function listingContexts(
  gw: Gateway,
  program: ProgramName,
  binding?: ConnectionBinding,
): string[] {
  const rows = binding === undefined ? gw.registered : gw.boundSurface(binding).registered;
  const group = groupPrograms(rows).get(program);
  const contexts = new Set<string>();
  for (const r of group?.lenses.values() ?? []) {
    for (const prop of r.schema.props.keys()) contexts.add(prop);
  }
  return [...contexts].sort();
}

export function listingMembershipJson(
  contexts: readonly string[],
  mask: unknown,
): Record<string, unknown> {
  return {
    op: "select",
    pred: { hasPointer: { context: { inSet: [...contexts].sort() } } },
    in: mask === undefined ? "input" : { op: "mask", policy: mask, in: "input" },
  };
}

async function ensureListingContainer(
  gw: Gateway,
  lens: string,
  program: ProgramName,
  membership: Record<string, unknown>,
  law: { operator: string; signer: Signer },
): Promise<string> {
  const name = listingContainerName(program);
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const standing = table.containers.get(name);
  if (standing !== undefined && (standing.trust !== "curated" || standing.posture !== "shared")) {
    throw new Error(
      `list ${lens}: "${name}" stands declared ${standing.trust}/${standing.posture}, and the ` +
        `listing reads only through the curated/shared container it declares itself — trust and ` +
        `posture are immutable (§28.4), so this name is taken. Negate that declaration, or leave ` +
        `this lens unlisted.`,
    );
  }
  if (table.detached.has(name)) {
    throw new Error(
      `list ${lens}: the backing container "${name}" is DETACHED — its candidate set is ` +
        `deliberately off the record, and an empty page here would read as "no entities" (H9). ` +
        `Reattach it, or exclude the container if an empty listing is what you mean.`,
    );
  }
  if (standing?.membershipAt !== undefined && standing.membership === undefined) {
    throw new Error(
      `list ${lens}: the backing container "${name}" carries its membership at a published ` +
        `address (${standing.membershipAt}), and this door compares the INLINE Term — it cannot ` +
        `tell whether that address already says what it would declare, so every read would mint ` +
        `one more declaration. Re-declare it inline, or leave this lens unlisted.`,
    );
  }
  if (
    standing?.membership !== undefined &&
    JSON.stringify(standing.membership) === JSON.stringify(membership)
  ) {
    return name;
  }
  await gw.append([
    law.signer.sign(
      withStamp(gw.stamp(law.operator), (t) =>
        containerClaims(
          {
            container: name,
            trust: "curated",
            posture: "shared",
            membership,
            ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
            ...(standing?.version === undefined ? {} : { version: standing.version }),
            ...(standing?.inboxOf === undefined ? {} : { inboxOf: standing.inboxOf }),
            ...(standing?.leewayDeclared ? { leeway: standing.leeway } : {}),
          },
          law.operator,
          t,
        ),
      ),
    ),
  ]);
  return name;
}

interface ListingIndex {
  readonly reactor: WeakRef<Reactor>;
  readonly membership: string;
  readonly contexts: ReadonlySet<string>;
  swept: number;
  readonly entities: string[];
  readonly seen: Set<string>;
  readonly feedsTrust: ((d: Delta) => boolean) | undefined;
}

const indexes = new WeakMap<Gateway, Map<string, ListingIndex>>();

export function projectListingEntities(
  members: Iterable<Delta>,
  contexts: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  for (const d of members) addPointedEntities(d, contexts, ids);
  return [...ids].sort();
}

function addPointedEntities(d: Delta, contexts: ReadonlySet<string>, into: Set<string>): void {
  for (const p of d.claims.pointers) {
    if (p.target.kind !== "entity") continue;
    const context = p.target.entity.context;
    if (context !== undefined && contexts.has(context)) into.add(p.target.entity.id);
  }
}

const isPlainClaim = (gw: Gateway, d: Delta, feedsTrust: (d: Delta) => boolean): boolean =>
  !isContainerLaw(d, gw.operatorAuthor) &&
  d.claims.pointers.every(
    (p) =>
      p.target.kind !== "delta" &&
      !(p.target.kind === "entity" && p.target.entity.id.startsWith(USER_PREFIX)),
  ) &&
  gw.reactor.negationsOf(d.id).length === 0 &&
  !feedsTrust(d);

export function trustFeeder(membership: unknown): ((d: Delta) => boolean) | undefined {
  if (hasMemberOf(membership)) return undefined;
  const term = parseTerm(membershipForValidation(membership));
  if (term.kind !== "select" || predUnbounded(term.pred)) return undefined;
  const of = term.of;
  if (of.kind === "input") return () => false;
  if (of.kind !== "mask" || of.of.kind !== "input") return undefined;
  if (of.policy.kind !== "trust") return () => false;
  const feeders: ((d: Delta) => boolean)[] = [];
  return boundTrust(of.policy.pred, feeders) ? (d) => feeders.some((f) => f(d)) : undefined;
}

function boundTrust(pred: Pred, feeders: ((d: Delta) => boolean)[]): boolean {
  switch (pred.kind) {
    case "and":
    case "or":
      return boundTrust(pred.left, feeders) && boundTrust(pred.right, feeders);
    case "not":
      return boundTrust(pred.pred, feeders);
    case "inView": {
      const feeder = mayJoin(pred.term);
      if (feeder === undefined) return false;
      feeders.push(feeder);
      return true;
    }
    default:
      return !predUnbounded(pred);
  }
}

function mayJoin(term: Term): ((d: Delta) => boolean) | undefined {
  if (term.kind !== "select" || predUnbounded(term.pred)) return undefined;
  const of = term.of;
  const overInput =
    of.kind === "input" ||
    (of.kind === "mask" &&
      of.of.kind === "input" &&
      (of.policy.kind !== "trust" || !predUnbounded(of.policy.pred)));
  if (!overInput) return undefined;
  const pred = term.pred;
  return (d) => evalPred(pred, d);
}

function predUnbounded(pred: Pred): boolean {
  switch (pred.kind) {
    case "and":
    case "or":
      return predUnbounded(pred.left) || predUnbounded(pred.right);
    case "not":
      return predUnbounded(pred.pred);
    case "inView":
      return true;
    case "match":
      return isHole(pred.constant);
    case "hasPointer": {
      const pp = pred.ppred;
      return (
        pp.role?.kind === "aliased" ||
        pp.context?.kind === "aliased" ||
        pp.targetEntity?.kind === "root" ||
        pp.targetEntity?.kind === "hole" ||
        (pp.targetValue?.kind === "vcmp" && isHole(pp.targetValue.value))
      );
    }
    default:
      return false;
  }
}

const isHole = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "hole";

const algebraIsPlain = (table: ContainerTable, container: string): boolean => {
  for (const name of table.excluded) {
    if (table.containers.has(name) && !table.detached.has(name)) return false;
  }
  for (const [name, rec] of table.containers) {
    if (rec.inboxOf === container && !table.detached.has(name)) return false;
  }
  return true;
};

function seek(sorted: readonly string[], needle: string, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const below = strict ? sorted[mid]! <= needle : sorted[mid]! < needle;
    if (below) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function mergeSorted(sorted: string[], fresh: string[]): void {
  fresh.sort();
  let i = sorted.length - 1;
  let j = fresh.length - 1;
  sorted.length += fresh.length;
  for (let k = sorted.length - 1; j >= 0; k -= 1) {
    if (i >= 0 && sorted[i]! > fresh[j]!) {
      sorted[k] = sorted[i]!;
      i -= 1;
    } else {
      sorted[k] = fresh[j]!;
      j -= 1;
    }
  }
}

function currentIndex(
  gw: Gateway,
  container: string,
  membership: Record<string, unknown>,
  contexts: ReadonlySet<string>,
): ListingIndex {
  const key = `${gw.usersEpoch}\u0000${JSON.stringify(membership)}`;
  let perGw = indexes.get(gw);
  if (perGw === undefined) {
    perGw = new Map<string, ListingIndex>();
    indexes.set(gw, perGw);
  }
  const byContainer = perGw;
  const log = gw.reactor.arrivalLog();
  const idx = byContainer.get(container);
  const rebuild = (): ListingIndex => {
    const entities = projectListingEntities(
      gw.containerScope({ containers: [container] }),
      contexts,
    );
    const fresh: ListingIndex = {
      reactor: new WeakRef(gw.reactor),
      membership: key,
      contexts,
      swept: log.length,
      entities,
      seen: new Set(entities),
      feedsTrust: idx?.membership === key ? idx.feedsTrust : trustFeeder(membership),
    };
    byContainer.set(container, fresh);
    return fresh;
  };
  if (idx === undefined || idx.reactor.deref() !== gw.reactor || idx.membership !== key) {
    return rebuild();
  }
  if (idx.feedsTrust === undefined) {
    return idx.swept === log.length ? idx : rebuild();
  }
  const fresh = new Set<string>();
  for (let i = idx.swept; i < log.length; i += 1) {
    if (!isPlainClaim(gw, log[i]!, idx.feedsTrust)) return rebuild();
    addPointedEntities(log[i]!, contexts, fresh);
  }
  const arrivals: string[] = [];
  for (const id of fresh) {
    if (idx.seen.has(id)) continue;
    idx.seen.add(id);
    arrivals.push(id);
  }
  if (arrivals.length > 0) mergeSorted(idx.entities, arrivals);
  idx.swept = log.length;
  return idx;
}

export async function listingPageImpl(
  gw: Gateway,
  name: string,
  opts: ListOptions = {},
  binding?: ConnectionBinding,
): Promise<string[]> {
  await gw.prepareRead();
  const now = gw.now();
  const def = gw.def(name, binding);
  assertChannelSourceLegible(gw, name, binding);
  const program = programOf(def);
  const limit = opts.limit ?? LISTING_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LISTING_MAX_LIMIT) {
    throw new Error(
      `list ${name}: limit must be an integer between 1 and ${LISTING_MAX_LIMIT} — each listed ` +
        `entity costs a resolution, so the page is bounded; walk the cursor for more`,
    );
  }
  if (binding !== undefined) {
    const inContexts = new Set(listingContexts(gw, program, binding));
    const after = opts.after;
    return projectListingEntities(
      withoutErasedScope(gw, gw.servingScope(now, { bound: binding.container })),
      inContexts,
    )
      .filter((id) => after === undefined || id > after)
      .slice(0, limit);
  }
  if (gw.operatorAuthor === undefined || gw.signer === undefined) {
    throw new Error(
      `list ${name}: a listing reads through the container that backs its hyperschema ` +
        `("${listingContainerName(program)}"), and an ungoverned store has no operator to ` +
        `declare one — open the gateway with an operator seed`,
    );
  }
  const contexts = listingContexts(gw, program);
  const membership = listingMembershipJson(contexts, programMaskJson(def.hyperschema.body));
  const container = await ensureListingContainer(gw, name, program, membership, {
    operator: gw.operatorAuthor,
    signer: gw.signer,
  });
  const inContexts = new Set(contexts);
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const after = opts.after;
  if (
    !algebraIsPlain(table, container) ||
    erasedFromReading(gw.reactor, gw.operatorAuthor).size > 0
  ) {
    return projectListingEntities(
      withoutErasedScope(gw, gw.servingScope(now, { containers: [container] })),
      inContexts,
    )
      .filter((id) => after === undefined || id > after)
      .slice(0, limit);
  }
  const idx = currentIndex(gw, container, membership, inContexts);
  const from = after === undefined ? 0 : seek(idx.entities, after, true);
  return idx.entities.slice(from, from + limit);
}

function withoutErasedScope(gw: Gateway, scope: readonly Delta[]): Delta[] {
  const hidden = erasedInScope(gw.reactor, gw.operatorAuthor, scope);
  return hidden.size === 0 ? [...scope] : scope.filter((d) => !hidden.has(d.id));
}

export async function listImpl(
  gw: Gateway,
  name: string,
  opts: ListOptions = {},
  binding?: ConnectionBinding,
): Promise<ResolvedNode[]> {
  const page = await listingPageImpl(gw, name, opts, binding);
  const nodes: ResolvedNode[] = [];
  for (const entity of page) {
    if (nodes.length > 0) await yieldToLoop();
    nodes.push(gw.resolvedNode(name, entity, undefined, undefined, binding));
  }
  return nodes;
}

const yieldToLoop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
