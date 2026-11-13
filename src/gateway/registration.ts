import {
  contentAddress,
  loadHyperSchema,
  loadSchema,
  parseSchema,
  parseTerm,
  publishSchemaClaims,
  schemaCanonicalHex,
  type Claims,
  type HyperSchema,
  type Schema,
  type Primitive,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";
import { negatedAt } from "./negation.js";
import { interpretBindingPolicy, readBindingPolicy } from "./binding-policy.js";
import { stamped, withStamp, type Stamp } from "./stamp.js";
import { lawfulHistory, lawfulScopeAt } from "./lawful.js";

export { lawfulNegated } from "./negation.js";

export const CTX_REGISTRATION = "loam.registration";

export function edgeRoles(body: Term): string[] {
  const roles = new Set<string>();
  const walk = (t: Term): void => {
    switch (t.kind) {
      case "expand":
        if (t.role.kind === "exact") roles.add(t.role.value);
        walk(t.of);
        break;
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        walk(t.of);
        break;
      case "union":
        walk(t.left);
        walk(t.right);
        break;
      case "input":
      case "fix":
        break;
    }
  };
  walk(body);
  return [...roles];
}

export interface RefReciprocal {
  readonly role: string;
  readonly context: string;
}
export interface RefSpec {
  readonly role: string;
  readonly reciprocal?: RefReciprocal;
}
export type RefSpecs = Readonly<Record<string, RefSpec>>;

export function parseRefs(raw: unknown): RefSpecs {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("refs must be an object of per-prop reference declarations");
  }
  const out: Record<string, RefSpec> = {};
  for (const [prop, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (prop === "__proto__") throw new Error(`refs: "${prop}" is not a usable prop name`);
    const s = spec as {
      role?: unknown;
      reciprocal?: { role?: unknown; context?: unknown } | null;
    } | null;
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`refs "${prop}": wants { role, reciprocal? }`);
    }
    if (typeof s.role !== "string" || s.role === "") {
      throw new Error(`refs "${prop}": role must be a non-empty string`);
    }
    if (s.reciprocal === undefined) {
      out[prop] = { role: s.role };
      continue;
    }
    const r = s.reciprocal;
    if (
      r === null ||
      typeof r !== "object" ||
      Array.isArray(r) ||
      typeof r.role !== "string" ||
      r.role === "" ||
      typeof r.context !== "string" ||
      r.context === ""
    ) {
      throw new Error(`refs "${prop}": reciprocal wants { role, context }, both non-empty strings`);
    }
    out[prop] = { role: s.role, reciprocal: { role: r.role, context: r.context } };
  }
  return out;
}

export interface ReferenceProp {
  readonly prop: string;
  readonly role: string;
  readonly reciprocal?: RefReciprocal;
  readonly links: boolean;
  readonly target?: string;
}

export function referenceProps(body: Term, refs: RefSpecs | undefined): Map<string, ReferenceProp> {
  const out = new Map<string, ReferenceProp>();
  if (refs === undefined) return out;
  const found: { matcher: { kind: string }; target: string }[] = [];
  const refName = (r: { kind: "name"; name: string } | { kind: "pinned"; hash: string }): string =>
    r.kind === "name" ? r.name : r.hash;
  const walk = (t: Term): void => {
    switch (t.kind) {
      case "expand":
        found.push({
          matcher: t.role,
          target: refName(t.reading ?? t.schema),
        });
        walk(t.of);
        break;
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        walk(t.of);
        break;
      case "union":
      case "intersect":
        walk(t.left);
        walk(t.right);
        break;
      case "difference":
        walk(t.of);
        walk(t.without);
        break;
      case "input":
      case "fix":
        break;
    }
  };
  walk(body);
  const matches = (m: { kind: string }, role: string): boolean => {
    const sm = m as { kind: string; value?: string; values?: readonly string[] };
    if (sm.kind === "exact") return sm.value === role;
    if (sm.kind === "prefix") return role.startsWith(sm.value ?? "");
    if (sm.kind === "inSet") return (sm.values ?? []).includes(role);
    return false;
  };
  for (const [prop, spec] of Object.entries(refs)) {
    const exact = found.find((e) => e.matcher.kind === "exact" && matches(e.matcher, spec.role));
    const family = exact ?? found.find((e) => matches(e.matcher, spec.role));
    out.set(prop, {
      prop,
      role: spec.role,
      ...(spec.reciprocal === undefined ? {} : { reciprocal: spec.reciprocal }),
      links: family === undefined || family === exact,
      ...(family === undefined ? {} : { target: family.target }),
    });
  }
  return out;
}

export function readinglessExpandRole(body: Term): string | undefined {
  const walk = (t: Term): string | undefined => {
    switch (t.kind) {
      case "expand":
        if (t.reading === undefined) return t.role.kind === "exact" ? t.role.value : "*";
        return walk(t.of);
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        return walk(t.of);
      case "union":
        return walk(t.left) ?? walk(t.right);
      case "input":
      case "fix":
        return undefined;
    }
  };
  return walk(body);
}

export interface ClaimPointerTemplate {
  readonly role: string;
  readonly at?: { readonly arg: string };
  readonly context?: string;
  readonly value?: { readonly arg: string } | Primitive;
  readonly each?: boolean;
}
export interface ClaimTemplate {
  readonly pointers: readonly ClaimPointerTemplate[];
}
export type ClaimTemplates = Readonly<Record<string, ClaimTemplate>>;

export type ResolverRung = "a";

export type ResolverOutputType = "string" | "number" | "boolean" | "list" | "object" | "bytes";
const RESOLVER_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "list",
  "object",
  "bytes",
]);

export interface ResolverSpec {
  readonly rung: ResolverRung;
  readonly type: ResolverOutputType;
  readonly code: string;
}
export type ResolverSpecs = Readonly<Record<string, ResolverSpec>>;

export function parseResolvers(raw: unknown): ResolverSpecs {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("resolvers must be an object of per-field resolver specs");
  }
  const out: Record<string, ResolverSpec> = {};
  for (const [field, spec] of Object.entries(raw as Record<string, unknown>)) {
    const s = spec as { rung?: unknown; type?: unknown; code?: unknown } | null;
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`resolver "${field}": wants { rung, type, code }`);
    }
    if (s.rung !== "a") {
      throw new Error(
        `resolver "${field}": rung ${JSON.stringify(s.rung)} is not admitted — v1 builds bucket-pure ` +
          `rung (a) only (SPEC §22); the higher rungs and synthetics are designed but not built`,
      );
    }
    if (typeof s.type !== "string" || !RESOLVER_TYPES.has(s.type)) {
      throw new Error(`resolver "${field}": type must be one of ${[...RESOLVER_TYPES].join(", ")}`);
    }
    if (typeof s.code !== "string" || s.code.trim() === "") {
      throw new Error(`resolver "${field}": code must be non-empty runnable ESM`);
    }
    out[field] = { rung: "a", type: s.type as ResolverOutputType, code: s.code };
  }
  return out;
}

export type LensName = string & { readonly __lens: unique symbol };
export type ProgramName = string & { readonly __program: unique symbol };

export const lensOf = (r: { lensName?: string; hyperschema: { name: string } }): LensName =>
  (r.lensName ?? r.hyperschema.name) as LensName;

type Lensed = { lensName?: string; hyperschema: { name: string } };

const lensIndexes = new WeakMap<readonly Lensed[], ReadonlyMap<string, Lensed>>();

export function byLens<T extends Lensed>(rows: readonly T[], name: string): T | undefined {
  let index = lensIndexes.get(rows);
  if (index === undefined) {
    const built = new Map<string, Lensed>();
    for (const r of rows) if (!built.has(lensOf(r))) built.set(lensOf(r), r);
    lensIndexes.set(rows, (index = built));
  }
  return index.get(name) as T | undefined;
}

export const lensNameFor = (hyperschema: HyperSchema, schema: Schema): LensName =>
  (schema.name ?? hyperschema.name) as LensName;

export const programOf = (r: { hyperschema: { name: string } }): ProgramName =>
  r.hyperschema.name as ProgramName;

export interface Registration {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly lensName?: string;
  readonly entity?: string;
  readonly boundAt?: number;

  readonly firstBoundAt?: number;
  readonly boundId?: string;
  readonly boundBy?: string;
  readonly mutations?: ClaimTemplates;
  readonly mutationsDefect?: string;
  readonly writable?: readonly string[];
  readonly resolvers?: ResolverSpecs;
  readonly refs?: RefSpecs;
  readonly refsDefect?: string;
}

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export function parseClaimTemplates(raw: unknown): ClaimTemplates {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("mutations must be an object of named claim templates");
  }
  const out: Record<string, ClaimTemplate> = {};
  const argOk = (a: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(a) && !a.startsWith("__");
  for (const [name, tpl] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`template "${name}": not a usable mutation name`);
    }
    const t = tpl as { pointers?: unknown };
    if (
      t === null ||
      typeof t !== "object" ||
      !Array.isArray(t.pointers) ||
      t.pointers.length === 0
    ) {
      throw new Error(`template "${name}": wants { pointers: [...] }, at least one`);
    }
    const pointers = t.pointers.map((p: unknown, i: number): ClaimPointerTemplate => {
      const o = p as Record<string, unknown>;
      if (
        o === null ||
        typeof o !== "object" ||
        typeof o["role"] !== "string" ||
        o["role"] === ""
      ) {
        throw new Error(`template "${name}" pointer ${i}: a pointer names a role`);
      }
      const at = o["at"] as { arg?: unknown } | undefined;
      const hasAt = at !== undefined;
      const hasValue = o["value"] !== undefined;
      if (hasAt === hasValue) {
        throw new Error(`template "${name}" pointer ${i}: exactly one of at/value`);
      }
      if (hasAt) {
        if (
          typeof at?.arg !== "string" ||
          !argOk(at.arg) ||
          typeof o["context"] !== "string" ||
          o["context"] === ""
        ) {
          throw new Error(
            `template "${name}" pointer ${i}: at wants { arg } (a usable argument name) ` +
              `and a non-empty context`,
          );
        }
        return {
          role: o["role"],
          at: { arg: at.arg },
          context: o["context"],
          ...(o["each"] === true ? { each: true } : {}),
        };
      }
      if (o["each"] === true) {
        throw new Error(`template "${name}" pointer ${i}: each belongs to entity pointers only`);
      }
      const value = o["value"];
      const hole = value as { arg?: unknown };
      if (typeof hole === "object" && hole !== null) {
        if (typeof hole.arg !== "string" || !argOk(hole.arg)) {
          throw new Error(
            `template "${name}" pointer ${i}: value hole wants { arg }, a usable argument name`,
          );
        }
        return { role: o["role"], value: { arg: hole.arg } };
      }
      if (!isPrimitive(value)) {
        throw new Error(`template "${name}" pointer ${i}: a literal value must be a primitive`);
      }
      return { role: o["role"], value };
    });
    out[name] = { pointers };
  }
  return out;
}

export const schemaEntityFor = (hyperschema: HyperSchema, entity?: string): string =>
  entity ?? `hyperschema:${hyperschema.name}`;

export const schemaLivingEntityFor = (name: string): string => `schema:${name}`;

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const versionedSchemaHash = (schema: Schema): string =>
  contentAddress(hexToBytes(schemaCanonicalHex(schema)));

export const versionedSchemaEntityFor = (name: string, schema: Schema): string =>
  `${schemaLivingEntityFor(name)}@${versionedSchemaHash(schema)}`;

const registrationEntity = (schemaEntity: string): string => `registration:${schemaEntity}`;

const CTX_POINTER = "registration";

export function registrationClaims(
  schemaEntity: string,
  livingEntity: string,
  snapshotEntity: string,
  roots: readonly string[],
  author: string,
  timestamp: number,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
  refs?: RefSpecs,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      ...(mutations === undefined
        ? []
        : [
            {
              role: "mutations",
              target: { kind: "primitive" as const, value: JSON.stringify(mutations) },
            },
          ]),
      ...(writable === undefined
        ? []
        : [
            {
              role: "writable",
              target: { kind: "primitive" as const, value: JSON.stringify(writable) },
            },
          ]),
      ...(resolvers === undefined
        ? []
        : [
            {
              role: "resolvers",
              target: { kind: "primitive" as const, value: JSON.stringify(resolvers) },
            },
          ]),
      ...(refs === undefined
        ? []
        : [
            {
              role: "refs",
              target: { kind: "primitive" as const, value: JSON.stringify(refs) },
            },
          ]),
      {
        role: "registers",
        target: {
          kind: "entity",
          entity: { id: registrationEntity(schemaEntity), context: CTX_REGISTRATION },
        },
      },
      {
        role: "hyperschema",
        target: { kind: "entity", entity: { id: schemaEntity, context: CTX_POINTER } },
      },
      {
        role: "schema",
        target: { kind: "entity", entity: { id: livingEntity, context: CTX_POINTER } },
      },
      {
        role: "schemaVersion",
        target: { kind: "entity", entity: { id: snapshotEntity, context: CTX_POINTER } },
      },
      { role: "roots", target: { kind: "primitive", value: JSON.stringify(roots) } },
    ],
  };
}

export interface RegistrationDeltaClaims {
  readonly living: Claims;
  readonly snapshot: Claims;
  readonly binding: Claims;
  readonly livingEntity: string;
  readonly snapshotEntity: string;
}
export function registrationDeltaClaims(
  schemaEntity: string,
  name: string,
  schema: Schema,
  roots: readonly string[],
  author: string,
  clock: () => number | Stamp,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
  refs?: RefSpecs,
): RegistrationDeltaClaims {
  const named: Schema = { ...schema, name, alg: schema.alg ?? 1 };
  const livingEntity = schemaLivingEntityFor(name);
  const snapshotEntity = versionedSchemaEntityFor(name, schema);
  const tick = (): Stamp => {
    const t = clock();
    return typeof t === "number" ? stamped(t) : t;
  };
  const living = withStamp(tick(), (t) => publishSchemaClaims(named, livingEntity, author, t));
  const snapshot = withStamp(tick(), (t) => publishSchemaClaims(named, snapshotEntity, author, t));
  const binding = withStamp(tick(), (t) =>
    registrationClaims(
      schemaEntity,
      livingEntity,
      snapshotEntity,
      roots,
      author,
      t,
      mutations,
      writable,
      resolvers,
      refs,
    ),
  );
  return { living, snapshot, binding, livingEntity, snapshotEntity };
}

export interface RegistrationInput {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: string[];
  readonly entity?: string;
  readonly mutations?: ClaimTemplates;
  readonly writable?: string[];
  readonly resolvers?: ResolverSpecs;
  readonly refs?: RefSpecs;
}

const POLICY_SHAPES =
  "a prop takes one of { pick: { order }, all: { order }, conflicts: { order }, merge: <fn>, " +
  "absentAs: { const, then } } — every order is { byTimestamp: 'desc' | 'asc' }, " +
  "{ byAuthorRank: [...] }, { byPred: { pred, then } }, { chain: [...] }, or the bare 'lexById'";

function parseSchemaNamed(input: unknown): Schema {
  try {
    return parseSchema(input);
  } catch (err) {
    throw new Error(
      `register: malformed schema at ${locateSchemaFailure(input)} — ${POLICY_SHAPES}`,
      {
        cause: err,
      },
    );
  }
}

function locateSchemaFailure(input: unknown): string {
  if (typeof input !== "object" || input === null) return "schema";
  const o = input as { props?: unknown; default?: unknown };
  if (o.props !== undefined && typeof o.props === "object" && o.props !== null) {
    for (const [name, policy] of Object.entries(o.props as Record<string, unknown>)) {
      try {
        parseSchema({ default: policy });
      } catch {
        return `schema.props.${name}`;
      }
    }
  }
  if ("default" in o) {
    try {
      parseSchema({ default: (o as { default?: unknown }).default });
    } catch {
      return "schema.default";
    }
  }
  return "schema";
}

export function parseRegistrationInput(raw: unknown): RegistrationInput {
  const o = raw as {
    hyperschema?: { name?: unknown; alg?: unknown; body?: unknown };
    schema?: unknown;
    roots?: unknown;
    entity?: unknown;
    mutations?: unknown;
    writable?: unknown;
    resolvers?: unknown;
    refs?: unknown;
  } | null;
  if (
    o === null ||
    typeof o !== "object" ||
    o.hyperschema === null ||
    typeof o.hyperschema !== "object"
  ) {
    throw new Error("register wants { hyperschema: { name, alg?, body }, schema, roots, entity? }");
  }
  const { name, alg, body } = o.hyperschema;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("register: hyperschema.name must be a non-empty string");
  }
  if (alg !== undefined && typeof alg !== "number") {
    throw new Error("register: hyperschema.alg must be a number when given");
  }
  if (!Array.isArray(o.roots) || o.roots.some((r) => typeof r !== "string")) {
    throw new Error("register: roots must be an array of entity ids");
  }
  if (o.entity !== undefined && typeof o.entity !== "string") {
    throw new Error("register: entity must be a string when given");
  }
  if (
    o.writable !== undefined &&
    (!Array.isArray(o.writable) || o.writable.some((f) => typeof f !== "string"))
  ) {
    throw new Error("register: writable must be an array of field names when given");
  }
  return {
    hyperschema: { name, alg: alg ?? 1, body: parseTerm(body) },
    schema: parseSchemaNamed(o.schema),
    roots: o.roots as string[],
    ...(o.entity === undefined ? {} : { entity: o.entity }),
    ...(o.mutations === undefined ? {} : { mutations: parseClaimTemplates(o.mutations) }),
    ...(o.writable === undefined ? {} : { writable: o.writable as string[] }),
    ...(o.resolvers === undefined ? {} : { resolvers: parseResolvers(o.resolvers) }),
    ...(o.refs === undefined ? {} : { refs: parseRefs(o.refs) }),
  };
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

interface Candidate {
  schemaEntity: string;
  livingEntity: string;
  snapshotEntity: string;
  roots: readonly string[];
  mutations?: ClaimTemplates;
  mutationsDefect?: string;
  writable?: readonly string[];
  resolvers?: ResolverSpecs;
  refs?: RefSpecs;
  refsDefect?: string;
  timestamp: number;
  id: string;
  author: string;
}

const entityRef = (claims: Claims, role: string): string | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

export type Boundary = { next?: number };

function survivingCandidates(
  reactor: Reactor,
  now: number,
  operator?: string,
  withdrawn?: Candidate[],
  boundary?: Boundary,
  alsoStruckBy?: string,
): Map<string, Candidate[]> {
  const lawful = lawfulHistory(reactor, operator);
  const byAuthor = negatedAt(reactor, now, operator);
  const byHolder = alsoStruckBy === undefined ? undefined : negatedAt(reactor, now, alsoStruckBy);
  const negated = (id: string): boolean => byAuthor(id) || (byHolder?.(id) ?? false);
  const groups = new Map<string, Candidate[]>();
  for (const delta of lawful) {
    const { validFrom, validUntil } = delta.claims;
    const valid = validFrom <= now && (validUntil === undefined || now < validUntil);
    let key: string | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION) {
        key = p.target.entity.id;
        break;
      }
    }
    if (key === undefined) continue;
    if (boundary !== undefined) {
      const times: (number | undefined)[] = [validFrom, validUntil];
      const chain = [...reactor.negationsOf(delta.id)];
      for (const negId of chain) {
        const neg = reactor.get(negId);
        if (neg === undefined) continue;
        times.push(neg.claims.validFrom, neg.claims.validUntil);
        chain.push(...reactor.negationsOf(negId));
      }
      for (const t of times) {
        if (t !== undefined && t > now && (boundary.next === undefined || t < boundary.next)) {
          boundary.next = t;
        }
      }
    }
    if (!valid) continue;
    const struck = negated(delta.id);
    if (struck && withdrawn === undefined) continue;

    const schemaRef = delta.claims.pointers.find(
      (p) => p.role === "hyperschema" && p.target.kind === "entity",
    );
    const livingEntity = entityRef(delta.claims, "schema");
    const snapshotEntity = entityRef(delta.claims, "schemaVersion");
    const rootsJson = primitive(delta.claims, "roots");
    if (
      schemaRef?.target.kind !== "entity" ||
      livingEntity === undefined ||
      snapshotEntity === undefined ||
      typeof rootsJson !== "string"
    ) {
      continue;
    }
    let roots: string[];
    try {
      roots = JSON.parse(rootsJson) as string[];
    } catch {
      continue;
    }
    let mutations: ClaimTemplates | undefined;
    let mutationsDefect: string | undefined;
    const mutationsJson = primitive(delta.claims, "mutations");
    if (typeof mutationsJson === "string") {
      try {
        mutations = parseClaimTemplates(JSON.parse(mutationsJson));
      } catch (err) {
        mutations = undefined;
        mutationsDefect = err instanceof Error ? err.message : String(err);
      }
    }
    let writable: readonly string[] | undefined;
    const writableJson = primitive(delta.claims, "writable");
    if (typeof writableJson === "string") {
      try {
        const parsed: unknown = JSON.parse(writableJson);
        if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) {
          writable = parsed;
        }
      } catch {
        writable = undefined;
      }
    }
    let resolvers: ResolverSpecs | undefined;
    const resolversJson = primitive(delta.claims, "resolvers");
    if (typeof resolversJson === "string") {
      try {
        resolvers = parseResolvers(JSON.parse(resolversJson));
      } catch {
        resolvers = undefined;
      }
    }
    let refs: RefSpecs | undefined;
    let refsDefect: string | undefined;
    const refsJson = primitive(delta.claims, "refs");
    if (typeof refsJson === "string") {
      try {
        refs = parseRefs(JSON.parse(refsJson));
      } catch (err) {
        refs = undefined;
        refsDefect = err instanceof Error ? err.message : String(err);
      }
    }
    const schemaEntity = schemaRef.target.entity.id;
    const candidate: Candidate = {
      schemaEntity,
      livingEntity,
      snapshotEntity,
      roots,
      ...(mutations === undefined ? {} : { mutations }),
      ...(mutationsDefect === undefined ? {} : { mutationsDefect }),
      ...(writable === undefined ? {} : { writable }),
      ...(resolvers === undefined ? {} : { resolvers }),
      ...(refs === undefined ? {} : { refs }),
      ...(refsDefect === undefined ? {} : { refsDefect }),
      timestamp: delta.claims.timestamp,
      id: delta.id,
      author: delta.claims.author,
    };
    if (struck) {
      withdrawn?.push(candidate);
      continue;
    }
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return groups;
}

const NUL_SEP = String.fromCharCode(0);

const lensNameOf = (cand: Candidate): LensName =>
  (cand.livingEntity.startsWith("schema:")
    ? cand.livingEntity.slice("schema:".length)
    : cand.livingEntity) as LensName;

export interface ContestedBinding {
  readonly entity: string;
  readonly author: string;
  readonly timestamp: number;
  readonly deltaId: string;
}

export function readContestedBindings(
  reactor: Reactor,
  now: number,
  operator?: string,
  alsoStruckBy?: string,
): Map<string, ContestedBinding[]> {
  const mode = readBindingPolicy(reactor, now, operator);
  const out = new Map<string, ContestedBinding[]>();
  if (mode !== "conflicts") return out;
  const groups = survivingCandidates(reactor, now, operator, undefined, undefined, alsoStruckBy);
  const latest = new Map<string, Candidate>();
  for (const [key, group] of groups) {
    for (const cand of group) latest.set([key, lensNameOf(cand)].join(NUL_SEP), cand);
  }
  const resolved = interpretBindingPolicy(
    [...latest.values()].map((c) => ({
      lens: lensNameOf(c),
      entity: c.schemaEntity,
      author: c.author,
      timestamp: c.timestamp,
      deltaId: c.id,
    })),
    mode,
    operator,
  );
  for (const [lens, list] of resolved.contested) {
    out.set(
      lens,
      list.map((c) => ({
        entity: c.entity,
        author: c.author,
        timestamp: c.timestamp,
        deltaId: c.deltaId,
      })),
    );
  }
  return out;
}

export function readLawfulContested(
  reactor: Reactor,
  now: number,
  governors: readonly string[],
): Map<string, ContestedBinding[]> {
  if (governors.length === 0) return readContestedBindings(reactor, now, undefined);
  const out = new Map<string, ContestedBinding[]>();
  const claimed = new Set<LensName>();
  const holder = governors[0];
  for (const governor of governors) {
    const also = governor === holder ? undefined : holder;
    for (const [lens, list] of readContestedBindings(reactor, now, governor, also)) {
      if (!claimed.has(lens as LensName) && !out.has(lens)) out.set(lens, list);
    }
    for (const group of survivingCandidates(
      reactor,
      now,
      governor,
      undefined,
      undefined,
      also,
    ).values()) {
      for (const cand of group) claimed.add(lensNameOf(cand));
    }
  }
  return out;
}

export function readLawfulRegistrations(
  reactor: Reactor,
  now: number,
  governors: readonly string[],
  boundary?: Boundary,
): Registration[] {
  if (governors.length === 0) return readRegistrations(reactor, now, undefined, boundary);
  const rows: Registration[] = [];
  const claimed = new Set<LensName>();
  const holder = governors[0];
  for (const governor of governors) {
    const also = governor === holder ? undefined : holder;
    for (const r of readRegistrations(reactor, now, governor, boundary, also)) {
      if (!claimed.has(lensOf(r))) rows.push(r);
    }
    for (const group of survivingCandidates(
      reactor,
      now,
      governor,
      undefined,
      boundary,
      also,
    ).values()) {
      for (const cand of group) claimed.add(lensNameOf(cand));
    }
  }
  return rows;
}

export function readRegistrations(
  reactor: Reactor,
  now: number,
  operator?: string,
  boundary?: Boundary,
  alsoStruckBy?: string,
): Registration[] {
  const groups = survivingCandidates(reactor, now, operator, undefined, boundary, alsoStruckBy);
  const latest = new Map<string, Candidate>();
  const first = new Map<string, number>();
  for (const [key, group] of groups) {
    for (const cand of group) {
      const at = [key, lensNameOf(cand)].join(NUL_SEP);
      latest.set(at, cand);
      if (!first.has(at)) first.set(at, cand.timestamp);
    }
  }
  const firstOf = new Map<Candidate, number>();
  for (const [at, survivor] of latest) firstOf.set(survivor, first.get(at) ?? survivor.timestamp);

  const mode = readBindingPolicy(reactor, now, operator);
  const resolvedAway = new Set<string>();
  if (mode !== undefined) {
    const resolved = interpretBindingPolicy(
      [...latest.values()].map((c) => ({
        lens: lensNameOf(c),
        entity: c.schemaEntity,
        author: c.author,
        timestamp: c.timestamp,
        deltaId: c.id,
      })),
      mode,
      operator,
    );
    for (const c of latest.values()) {
      const lens = lensNameOf(c) as string;
      const winner = resolved.winners.get(lens);
      if (winner !== c.id) resolvedAway.add(c.id);
    }
  }

  const out: Registration[] = [];
  for (const cand of [...latest.values()].sort((a, b) => a.timestamp - b.timestamp)) {
    if (resolvedAway.has(cand.id)) continue;
    const definition = lawfulScopeAt(reactor, now, cand.schemaEntity, operator);
    const reading = lawfulScopeAt(reactor, now, cand.snapshotEntity, operator);
    try {
      const hyperschema = loadHyperSchema(definition, cand.schemaEntity, now);
      if (hyperschema.name.includes("\u0000")) continue;
      const schema = loadSchema(reading, cand.snapshotEntity, now);
      out.push({
        hyperschema,
        schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        lensName: lensNameOf(cand),
        boundAt: cand.timestamp,
        firstBoundAt: firstOf.get(cand) ?? cand.timestamp,
        boundId: cand.id,
        boundBy: cand.author,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.mutationsDefect === undefined ? {} : { mutationsDefect: cand.mutationsDefect }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
        ...(cand.resolvers === undefined ? {} : { resolvers: cand.resolvers }),
        ...(cand.refs === undefined ? {} : { refs: cand.refs }),
        ...(cand.refsDefect === undefined ? {} : { refsDefect: cand.refsDefect }),
      });
    } catch {}
  }
  return out;
}

export interface RegistrationVersion extends Registration {
  readonly version: number;
  readonly deltaId: string;
  readonly timestamp: number;
}

export function readRegistrationVersions(
  reactor: Reactor,
  now: number,
  operator?: string,
): RegistrationVersion[] {
  const out: RegistrationVersion[] = [];
  for (const group of survivingCandidates(reactor, now, operator).values()) {
    let n = 0;
    for (const cand of group) {
      let hyperschema: HyperSchema;
      let schema: Schema;
      const definition = lawfulScopeAt(reactor, now, cand.schemaEntity, operator);
      const reading = lawfulScopeAt(reactor, now, cand.snapshotEntity, operator);
      try {
        hyperschema = loadHyperSchema(definition, cand.schemaEntity, now);
        if (hyperschema.name.includes(String.fromCharCode(0))) continue;
        schema = loadSchema(reading, cand.snapshotEntity, now);
      } catch {
        continue;
      }
      n += 1;
      out.push({
        hyperschema,
        schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        lensName: lensNameOf(cand),
        boundAt: cand.timestamp,
        boundId: cand.id,
        boundBy: cand.author,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
        ...(cand.resolvers === undefined ? {} : { resolvers: cand.resolvers }),
        ...(cand.refs === undefined ? {} : { refs: cand.refs }),
        version: n,
        deltaId: cand.id,
        timestamp: cand.timestamp,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0),
  );
}

export interface WithdrawnRegistration {
  readonly deltaId: string;
  readonly lensName: LensName;
}

export function readWithdrawnRegistrations(
  reactor: Reactor,
  now: number,
  operator?: string,
): WithdrawnRegistration[] {
  const withdrawn: Candidate[] = [];
  survivingCandidates(reactor, now, operator, withdrawn);
  const out: WithdrawnRegistration[] = [];
  for (const cand of withdrawn) {
    const definition = lawfulScopeAt(reactor, now, cand.schemaEntity, operator);
    try {
      loadHyperSchema(definition, cand.schemaEntity, now);
      out.push({ deltaId: cand.id, lensName: lensNameOf(cand) });
    } catch {}
  }
  return out;
}
