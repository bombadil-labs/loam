// Governed trust: which authors' strikes a governed read honors, and the lowering that lets a grant
// name a USER. The trust predicate (`lawfulStrikersJson`) reflects each surviving operator grant's
// subject STRING into the author set. A grant naming `user:<name>` must count as that user's root
// key, which no Term can say (it has no join). So every evaluation lowers the WHOLE predicate to an
// explicit `match author inSet [...]` computed here, over the same input the reflection would see.
// The signed body is never lowered: hashes, signatures and stored declarations keep the canonical
// form, and only the program handed to an evaluator changes.
//
// Two modes, because rhizomatic has two evaluators. `evalTerm` is `evalTermRaw` over the input
// filtered to what is valid at `now`; its grants resolve users to the one root at `now`. Raw
// evaluation ignores validity, so its grants expand a user to every root the operator named and
// did not strike (`userRootsRaw`), read in the same raw posture as the grants. A key-named grant
// trusts exactly what it trusted before lowering, in either mode.
//
// A predicate that LOOKS governed but is not byte-for-byte canonical fails closed: evaluated
// unlowered it would reflect `user:` strings as authors. Only mask trust policies are checked; an
// `inView` anywhere else is ordinary law.

import {
  DeltaSet,
  collectRefs,
  evalTerm,
  evalTermRaw,
  parsePred,
  parseTerm,
  predToJson,
  termToJson,
  type Delta,
  type Pred,
  type Reactor,
  type SchemaRegistry,
  type Term,
} from "@bombadil/rhizomatic";
import { STORE_ENTITY } from "./genesis.js";
import {
  retiredKeysOf,
  USER_PREFIX,
  userGroundOf,
  usersGovernor,
  userRootAt,
  userRootsRaw,
  type UserGround,
} from "./user-root.js";

export const CTX_GRANTS = "loam.grants";

/** How the evaluation that runs a lowered program reads validity. */
export type TrustRead = { readonly now: number } | { readonly raw: true };

// The operator's surviving grants, as a Term: grant-shaped deltas the operator minted (admin grants
// only, when asked), after masking by the operator's own negations — a stranger cannot shrink the
// trusted set by negating a grant delta.
function lawfulGrantsTermJson(operator: string, adminsOnly: boolean): unknown {
  const operatorMinted = { match: { field: "author", cmp: "eq", const: operator } };
  const grantShaped = {
    hasPointer: { targetEntity: STORE_ENTITY, context: { exact: CTX_GRANTS } },
  };
  const adminVerbed = {
    hasPointer: { role: { exact: "verb" }, targetValue: { vcmp: { cmp: "eq", value: "admin" } } },
  };
  return {
    op: "select",
    pred: {
      and: [grantShaped, adminsOnly ? { and: [operatorMinted, adminVerbed] } : operatorMinted],
    },
    in: {
      op: "mask",
      policy: { trust: { match: { field: "author", cmp: "eq", const: operator } } },
      in: "input",
    },
  };
}

/** @internal — the data-strike trust predicate, exported for its parity rail */
export function lawfulStrikersJson(operator: string, adminsOnly: boolean): unknown {
  return {
    or: [
      { match: { field: "author", cmp: "eq", const: operator } },
      {
        inView: {
          term: lawfulGrantsTermJson(operator, adminsOnly),
          field: "author",
          extract: { role: "subject" },
        },
      },
    ],
  };
}

// The strings an `inView` extract reflects from one pointer role, exactly as the substrate's
// `extractReflected` does: an entity id, a delta id, or a STRING primitive.
function reflectedSubjects(d: Delta, role: string): string[] {
  const out: string[] = [];
  for (const p of d.claims.pointers) {
    if (p.role !== role) continue;
    const t = p.target;
    if (t.kind === "entity") out.push(t.entity.id);
    else if (t.kind === "delta") out.push(t.deltaRef.delta);
    else if (typeof t.value === "string") out.push(t.value);
  }
  return out;
}

/**
 * The trusted strikers: the operator, plus the key each surviving grant's subject names. A key
 * names itself; `user:<name>` names the user's root (ruling 8: the root only, never a key acting
 * for it by delegation). A user with no readable root adds nobody. `input` is what the evaluation
 * sees: the whole input when lowering, or the grants and their negation closure when a caller
 * indexes them. With no user ground, a user subject adds nobody.
 */
export function governedStrikers(
  input: DeltaSet,
  read: TrustRead,
  operator: string,
  adminsOnly: boolean,
  users: UserGround | undefined,
): string[] {
  const term = parseTerm(lawfulGrantsTermJson(operator, adminsOnly));
  const grants = "raw" in read ? evalTermRaw(term, input) : evalTerm(term, input, read.now);
  if (grants.sort !== "dset")
    throw new Error("the lawful-grants term always evaluates to a delta set");
  const erased = users?.erased();
  // A key a recovery retired strikes nothing (refactor/audit/user-recovery.md).
  const retired =
    users === undefined
      ? new Set<string>()
      : retiredKeysOf(users.reactor, usersGovernor(users, operator), erased, users.cut);
  const out = new Set<string>([operator]);
  for (const g of grants.set) {
    for (const subject of reflectedSubjects(g, "subject")) {
      if (!subject.startsWith(USER_PREFIX)) {
        out.add(subject);
        continue;
      }
      const name = subject.slice(USER_PREFIX.length);
      if (users === undefined) continue;
      if ("raw" in read) {
        for (const k of userRootsRaw(users, operator, name)) out.add(k);
      } else {
        const root = userRootAt(
          users.reactor,
          read.now,
          usersGovernor(users, operator),
          name,
          erased,
          users.cut,
        );
        if (root !== undefined) out.add(root);
      }
    }
  }
  for (const k of retired) if (k !== operator) out.delete(k);
  return [...out].sort();
}

/**
 * The deltas that decide which grants survive in `reactor`: every grant (all are filed at the store
 * entity) with its whole negation closure (H1), less `hidden`. Evaluating the grants term over this
 * set answers as it would over the whole store less `hidden`, from the index rather than a scan.
 */
export function grantGround(reactor: Reactor, hidden: ReadonlySet<string> = NO_IDS): DeltaSet {
  const scope = new Map<string, Delta>();
  const take = (id: string): void => {
    if (hidden.has(id) || scope.has(id)) return;
    const d = reactor.get(id);
    if (d === undefined) return;
    scope.set(id, d);
    for (const n of reactor.negationsOf(id)) take(n);
  };
  for (const id of reactor.byTarget(STORE_ENTITY)) take(id);
  return DeltaSet.from(scope.values());
}

const NO_IDS: ReadonlySet<string> = new Set();

// What a door read withholds from a reactor's ground at `now` (erased-but-held deltas, and a
// slate's read closure: `readClosedIds`). The Gateway declares it, because the readers live above
// this module. A governed read evaluates over the ground less these, so the strikers that answer
// "is this struck as data" must be computed over the same ground.
const readHidden = new WeakMap<Reactor, (now: number) => ReadonlySet<string>>();

/** Declare what a door read of `reactor` withholds at a given instant. */
export function declareReadHidden(
  reactor: Reactor,
  hidden: (now: number) => ReadonlySet<string>,
): void {
  readHidden.set(reactor, hidden);
}

/** The strikers a reactor's own data answers to at `now`, over the ground a door reads. */
export function dataStrikers(reactor: Reactor, now: number, operator: string): Set<string> {
  const hidden = readHidden.get(reactor)?.(now) ?? NO_IDS;
  return new Set(
    governedStrikers(grantGround(reactor, hidden), { now }, operator, false, userGroundOf(reactor)),
  );
}

// ── recognition ──────────────────────────────────────────────────────────────────────────────

const canonical = new Map<string, string>();
const canonicalJson = (operator: string, adminsOnly: boolean): string => {
  const key = `${adminsOnly ? "a" : "w"}:${operator}`;
  let hit = canonical.get(key);
  if (hit === undefined) {
    hit = JSON.stringify(predToJson(parsePred(lawfulStrikersJson(operator, adminsOnly))));
    canonical.set(key, hit);
  }
  return hit;
};

// The operator and flag a canonical governed predicate names, or undefined for any other pred.
function governedShape(pred: Pred): { operator: string; adminsOnly: boolean } | undefined {
  if (pred.kind !== "or" || pred.left.kind !== "match") return undefined;
  const { field, cmp, constant } = pred.left;
  if (field !== "author" || cmp !== "eq" || typeof constant !== "string") return undefined;
  const json = JSON.stringify(predToJson(pred));
  for (const adminsOnly of [false, true]) {
    if (json === canonicalJson(constant, adminsOnly)) return { operator: constant, adminsOnly };
  }
  return undefined;
}

// An `inView` that reads like a grant reflection: it extracts the subject role, or its term names
// the grants context. Inside a trust policy, one that survived lowering is a near miss.
function grantish(pred: Pred): boolean {
  if (pred.kind !== "inView") return false;
  if (pred.extract.kind === "role" && pred.extract.role === "subject") return true;
  return JSON.stringify(termToJson(pred.term)).includes(JSON.stringify(CTX_GRANTS));
}

type PredMap = (pred: Pred, inTrust: boolean) => Pred;

// Rebuild a Term, handing every Pred to `f` (outermost first) — the same positions rhizomatic's
// principal lowering walks: select, mask trust, inView sub-terms, and resolve orders.
function mapTerm(term: Term, f: PredMap): Term {
  const pred = (p: Pred, inTrust: boolean): Pred => {
    const q = f(p, inTrust);
    switch (q.kind) {
      case "and":
      case "or":
        return { ...q, left: pred(q.left, inTrust), right: pred(q.right, inTrust) };
      case "not":
        return { ...q, pred: pred(q.pred, inTrust) };
      case "inView":
        return { ...q, term: walk(q.term) };
      default:
        return q;
    }
  };
  type Sch = Extract<Term, { kind: "resolve" }>["schema"];
  type Pol = Sch["default"];
  type Ord = Extract<Pol, { kind: "pick" }>["order"];
  const order = (o: Ord): Ord => {
    switch (o.kind) {
      case "byPred":
        return { ...o, pred: pred(o.pred, false), then: order(o.then) };
      case "chain":
        return { ...o, orders: o.orders.map(order) };
      default:
        return o;
    }
  };
  const policy = (p: Pol): Pol => {
    switch (p.kind) {
      case "pick":
      case "all":
      case "conflicts":
        return { ...p, order: order(p.order) };
      case "absentAs":
        return { ...p, then: policy(p.then) };
      default:
        return p;
    }
  };
  const walk = (node: Term): Term => {
    switch (node.kind) {
      case "input":
      case "fix":
        return node;
      case "select":
        return { ...node, pred: pred(node.pred, false), of: walk(node.of) };
      case "union":
      case "intersect":
        return { ...node, left: walk(node.left), right: walk(node.right) };
      case "difference":
        return { ...node, of: walk(node.of), without: walk(node.without) };
      case "mask":
        return {
          ...node,
          policy:
            node.policy.kind === "trust"
              ? { kind: "trust", pred: pred(node.policy.pred, true) }
              : node.policy,
          of: walk(node.of),
        };
      case "resolve":
        return {
          ...node,
          schema: {
            ...node.schema,
            props: new Map([...node.schema.props].map(([k, v]) => [k, policy(v)])),
            default: policy(node.schema.default),
          },
          of: walk(node.of),
        };
      default:
        return { ...node, of: walk(node.of) };
    }
  };
  return walk(term);
}

/** Does `term` carry a governed predicate, or a near miss that lowering must refuse? */
export function governs(term: Term): boolean {
  let found = false;
  mapTerm(term, (p, inTrust) => {
    if (governedShape(p) !== undefined || (inTrust && grantish(p))) found = true;
    return p;
  });
  return found;
}

/**
 * `term` with every governed predicate lowered to the explicit striker set, for an evaluation
 * over `input` that reads validity as `read`. Throws on a near miss in a trust policy. The
 * striker set is computed once per operator and flag, for this evaluation only.
 */
export function lowerGovernedTerm(
  term: Term,
  input: DeltaSet,
  read: TrustRead,
  users: UserGround | undefined,
): Term {
  const memo = new Map<string, readonly string[]>();
  const lowered = mapTerm(term, (p) => {
    const shape = governedShape(p);
    if (shape === undefined) return p;
    const key = `${shape.adminsOnly ? "a" : "w"}:${shape.operator}`;
    let authors = memo.get(key);
    if (authors === undefined) {
      authors = governedStrikers(input, read, shape.operator, shape.adminsOnly, users);
      memo.set(key, authors);
    }
    return { kind: "match", field: "author", cmp: "inSet", constant: authors };
  });
  mapTerm(lowered, (p, inTrust) => {
    if (inTrust && grantish(p)) {
      throw new Error(
        `a trust policy reflects grants in a shape Loam does not recognize as governed trust: ` +
          `${JSON.stringify(predToJson(p))}. Only the canonical lawfulStrikersJson predicate can ` +
          `name users, and evaluating this one as written would trust the text of a grant's ` +
          `subject rather than the key it names.`,
      );
    }
    return p;
  });
  return lowered;
}

/** Does `term`, or any body it references through `registry`, need lowering? */
export function needsLowering(term: Term, registry: SchemaRegistry | undefined): boolean {
  if (governs(term)) return true;
  if (registry === undefined) return false;
  const seen = new Set<string>();
  const queue = collectRefs(term);
  while (queue.length > 0) {
    const ref = queue.pop()!;
    const key = ref.kind === "name" ? `n:${ref.name}` : `h:${ref.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const schema = registry.resolve(ref);
    if (schema === undefined) continue;
    if (governs(schema.body)) return true;
    queue.push(...collectRefs(schema.body));
  }
  return false;
}

/** The program an evaluator runs: `term` and `registry`, lowered when either needs it. */
export function governedProgram(
  term: Term,
  registry: SchemaRegistry | undefined,
  input: DeltaSet,
  read: TrustRead,
  users: UserGround | undefined,
): { readonly term: Term; readonly registry: SchemaRegistry | undefined } {
  if (!needsLowering(term, registry)) return { term, registry };
  return {
    term: lowerGovernedTerm(term, input, read, users),
    registry:
      registry === undefined
        ? undefined
        : registry.mapEvaluationBodies(
            (body) => (governs(body) ? lowerGovernedTerm(body, input, read, users) : body),
            (reading) => {
              const wrapper: Term = { kind: "resolve", schema: reading, of: { kind: "input" } };
              if (!governs(wrapper)) return reading;
              const lowered = lowerGovernedTerm(wrapper, input, read, users);
              if (lowered.kind !== "resolve") throw new Error("governed reading lowering failed");
              return lowered.schema;
            },
          ),
  };
}

/**
 * The `lowerTerm` hook for `Reactor.register`, or undefined when the program needs none — a hook
 * turns root anchoring off, so an ordinary body must not carry one. The hook re-lowers on every
 * refresh, at the refresh's own instant.
 */
export function governedHook(
  term: Term,
  registry: SchemaRegistry | undefined,
  users: () => UserGround,
):
  | ((
      body: Term,
      input: DeltaSet,
      now: number,
      available: SchemaRegistry | undefined,
    ) => { term: Term; registry?: SchemaRegistry })
  | undefined {
  if (!needsLowering(term, registry)) return undefined;
  return (body, input, now, available) => {
    const program = governedProgram(body, available, input, { now }, users());
    return {
      term: program.term,
      ...(program.registry === undefined ? {} : { registry: program.registry }),
    };
  };
}
