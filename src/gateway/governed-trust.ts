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
  scopeIds,
  type Admits,
} from "@bombadil/rhizomatic";
import { STORE_ENTITY } from "./genesis.js";
import { declarationsOf } from "./ground-declarations.js";
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

export type TrustRead = { readonly now: number } | { readonly raw: true };

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

export function grantGround(
  reactor: Reactor,
  hidden: ReadonlySet<string> = NO_IDS,
  admits?: Admits,
): DeltaSet {
  const keep =
    hidden.size === 0 && admits === undefined
      ? undefined
      : (d: Delta) => !hidden.has(d.id) && (admits === undefined || admits(d));
  return reactor.subset(scopeIds(reactor, [STORE_ENTITY], keep));
}

const NO_IDS: ReadonlySet<string> = new Set();

export function declareReadHidden(
  reactor: Reactor,
  hidden: (now: number) => ReadonlySet<string>,
): void {
  declarationsOf(reactor).readHidden = hidden;
}

export function dataStrikers(reactor: Reactor, now: number, operator: string): Set<string> {
  const hidden = declarationsOf(reactor).readHidden?.(now) ?? NO_IDS;
  return new Set(
    governedStrikers(grantGround(reactor, hidden), { now }, operator, false, userGroundOf(reactor)),
  );
}

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

function grantish(pred: Pred): boolean {
  if (pred.kind !== "inView") return false;
  if (pred.extract.kind === "role" && pred.extract.role === "subject") return true;
  return JSON.stringify(termToJson(pred.term)).includes(JSON.stringify(CTX_GRANTS));
}

type PredMap = (pred: Pred, inTrust: boolean) => Pred;

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

export function governs(term: Term): boolean {
  let found = false;
  mapTerm(term, (p, inTrust) => {
    if (governedShape(p) !== undefined || (inTrust && grantish(p))) found = true;
    return p;
  });
  return found;
}

export function lowerGovernedTerm(
  term: Term,
  input: DeltaSet,
  read: TrustRead,
  users: UserGround | undefined,
  memo: Map<string, readonly string[]> = new Map(),
): Term {
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

export function governedProgram(
  term: Term,
  registry: SchemaRegistry | undefined,
  input: DeltaSet,
  read: TrustRead,
  users: UserGround | undefined,
): { readonly term: Term; readonly registry: SchemaRegistry | undefined } {
  if (!needsLowering(term, registry)) return { term, registry };
  const memo = new Map<string, readonly string[]>();
  return {
    term: lowerGovernedTerm(term, input, read, users, memo),
    registry:
      registry === undefined
        ? undefined
        : registry.mapEvaluationBodies(
            (body) => (governs(body) ? lowerGovernedTerm(body, input, read, users, memo) : body),
            (reading) => {
              const wrapper: Term = { kind: "resolve", schema: reading, of: { kind: "input" } };
              if (!governs(wrapper)) return reading;
              const lowered = lowerGovernedTerm(wrapper, input, read, users, memo);
              if (lowered.kind !== "resolve") throw new Error("governed reading lowering failed");
              return lowered.schema;
            },
          ),
  };
}

export function governedHook(
  term: Term,
  registry: SchemaRegistry | undefined,
  users: () => UserGround,
  reactor: Reactor,
):
  | ((
      body: Term,
      input: DeltaSet,
      now: number,
      available: SchemaRegistry | undefined,
    ) => { term: Term; registry?: SchemaRegistry })
  | undefined {
  if (!needsLowering(term, registry)) return undefined;
  return (body, _input, now, available) => {
    const program = governedProgram(body, available, grantGround(reactor), { now }, users());
    return {
      term: program.term,
      ...(program.registry === undefined ? {} : { registry: program.registry }),
    };
  };
}
