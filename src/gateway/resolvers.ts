import { isBytesView } from "./bytes.js";
import {
  contentAddress,
  resolveView,
  schemaHash,
  type Delta,
  type HVEntry,
  type HView,
  type Policy,
  type Schema,
  type View,
} from "@bombadil/rhizomatic";
import { isWithheldResolver } from "./adopt-vocab.js";
import { importEsm } from "./esm.js";
import type { ResolverOutputType, ResolverSpecs } from "./registration.js";

export interface BucketEntry {
  readonly value: View;
  readonly timestamp: number;
  readonly author: string;

  readonly negated: boolean;
}

export type ResolveFn = (bucket: readonly BucketEntry[]) => View;

export const resolverAddress = (code: string): string =>
  contentAddress(new TextEncoder().encode(code));

const renderTarget = (
  e: HVEntry,
  i: number,
  t: Delta["claims"]["pointers"][number]["target"],
): View => {
  const expansion = e.expanded?.get(i);
  const reading = e.readings?.get(i);
  if (expansion !== undefined && reading !== undefined) {
    return resolveView(reading, expansion);
  }
  switch (t.kind) {
    case "primitive":
      return t.value;
    case "entity":
      return t.entity.id;
    case "delta":
      return t.deltaRef.delta;
    case "bytes":
      return { mime: t.mime, value: t.value };
  }
};

const candidateValue = (e: HVEntry, root: string): View => {
  const nonFiling: Array<[string, View]> = [];
  e.delta.claims.pointers.forEach((p, i) => {
    if (p.target.kind === "entity" && p.target.entity.id === root) return;
    nonFiling.push([p.role, renderTarget(e, i, p.target)]);
  });
  if (nonFiling.length === 0) return true;
  if (nonFiling.length === 1) return nonFiling[0]![1];
  const obj: Record<string, View> = {};
  for (const [role, v] of nonFiling) {
    const existing = obj[role];
    if (existing === undefined) obj[role] = v;
    else
      obj[role] = Array.isArray(existing) ? [...(existing as readonly View[]), v] : [existing, v];
  }
  return obj;
};

const readingIds = new WeakMap<Schema, string>();
const readingId = (schema: Schema): string => {
  let id = readingIds.get(schema);
  if (id === undefined) {
    id = schemaHash(schema);
    readingIds.set(schema, id);
  }
  return id;
};

const dependencyIds = (e: HVEntry, into: string[]): void => {
  into.push(e.negated ? `${e.delta.id}!` : e.delta.id);
  if (e.expanded === undefined) return;
  for (const [i, child] of e.expanded) {
    const reading = e.readings?.get(i);
    if (reading !== undefined) into.push(readingId(reading));
    for (const entries of child.props.values()) {
      for (const childEntry of entries) {
        dependencyIds(childEntry, into);
      }
    }
  }
};

export function bucketOf(
  hview: HView,
  field: string,
  root: string,
): { entries: BucketEntry[]; deltaIds: string[] } {
  const entries: BucketEntry[] = [];
  const deltaIds: string[] = [];
  for (const e of hview.props.get(field) ?? []) {
    entries.push({
      value: candidateValue(e, root),
      timestamp: e.delta.claims.timestamp,
      author: e.delta.claims.author,
      negated: e.negated,
    });
    dependencyIds(e, deltaIds);
  }
  return { entries, deltaIds };
}

const loaded = new Map<string, ResolveFn>();

export async function loadResolver(code: string): Promise<ResolveFn> {
  const address = resolverAddress(code);
  const hit = loaded.get(address);
  if (hit !== undefined) return hit;
  const mod = await importEsm(code);
  if (typeof mod.default !== "function") {
    throw new Error("a resolver's ESM must `export default` a function (bucket) => value");
  }
  const fn = mod.default as ResolveFn;
  loaded.set(address, fn);
  return fn;
}

export async function loadResolvers(
  specsList: ReadonlyArray<ResolverSpecs | undefined>,
): Promise<void> {
  const codes = new Set<string>();
  for (const specs of specsList) {
    if (specs === undefined) continue;
    for (const spec of Object.values(specs)) codes.add(spec.code);
  }
  await Promise.all([...codes].map((code) => loadResolver(code)));
}

export type ResolverMemo = Map<string, View>;
export const newResolverMemo = (): ResolverMemo => new Map();

const memoKey = (address: string, root: string, deltaIds: readonly string[]): string =>
  `${address}\u0000${root}\u0000${[...deltaIds].sort().join(",")}`;

function matchesDeclaredType(value: unknown, type: ResolverOutputType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "list":
      return Array.isArray(value);
    case "bytes":
      return isBytesView(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value) && !isBytesView(value)
      );
    default:
      return false;
  }
}

export function applyResolvers(
  resolvers: ResolverSpecs | undefined,
  view: Record<string, View>,
  hview: HView,
  root: string,
  memo: ResolverMemo,

  lens: string | undefined,
): Record<string, View> {
  if (resolvers === undefined) return view;
  const out: Record<string, View> = { ...view };
  for (const [field, spec] of Object.entries(resolvers)) {
    if (lens !== undefined && isWithheldResolver(spec.code, lens, field)) {
      delete out[field];
      continue;
    }
    const fn = loaded.get(resolverAddress(spec.code));
    if (fn === undefined) continue;
    const { entries, deltaIds } = bucketOf(hview, field, root);
    const key = memoKey(resolverAddress(spec.code), root, deltaIds);
    const cached = memo.get(key);
    if (cached !== undefined) {
      out[field] = cached;
      continue;
    }
    try {
      const value = fn(entries);
      if (!matchesDeclaredType(value, spec.type)) continue;
      memo.set(key, value);
      out[field] = value;
    } catch {}
  }
  return out;
}

type ChildRef = {
  readonly hview: HView;
  readonly reading: Schema;
  readonly root: string;
  readonly role: string;
};

const expandedChildrenByField = (hview: HView): Map<string, ChildRef[]> => {
  const byField = new Map<string, ChildRef[]>();
  for (const [field, entries] of hview.props) {
    for (const e of entries) {
      if (e.expanded === undefined) continue;
      for (const [i, childHView] of e.expanded) {
        const reading = e.readings?.get(i);
        const ptr = e.delta.claims.pointers[i];
        if (reading === undefined || ptr?.target.kind !== "entity") continue;
        const refs = byField.get(field) ?? byField.set(field, []).get(field)!;
        refs.push({ hview: childHView, reading, root: ptr.target.entity.id, role: ptr.role });
      }
    }
  }
  return byField;
};

const stripExpansions = (hview: HView): HView => ({
  id: hview.id,
  props: new Map(
    [...hview.props].map(([field, entries]) => [
      field,
      entries.map((e) => ({ delta: e.delta, negated: e.negated })),
    ]),
  ),
});

const alignsUnderStripping = (policy: Policy | undefined): boolean => {
  switch (policy?.kind) {
    case "pick":
    case "all":
      return true;
    case "absentAs":
      return alignsUnderStripping(policy.then);
    default:
      return false;
  }
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !isBytesView(v);

const childAt = (refs: readonly ChildRef[], root: string, role?: string): ChildRef | undefined => {
  const hits = refs.filter((r) => r.root === root && (role === undefined || r.role === role));
  if (hits.length === 0) return undefined;
  const readings = new Set(hits.map((r) => r.reading.name ?? ""));
  return readings.size === 1 ? hits[0] : undefined;
};

const decorateOne = (
  childView: Record<string, View>,
  ref: ChildRef,
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
): Record<string, View> => {
  const withOwn = applyResolvers(
    ref.reading.name === undefined ? undefined : readingResolvers(ref.reading.name),
    childView,
    ref.hview,
    ref.root,
    memo,
    ref.reading.name,
  );
  return decorateChildren(withOwn, ref.hview, ref.reading, readingResolvers, memo);
};

const spliceField = (
  value: View,
  idValue: unknown,
  refs: readonly ChildRef[],
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
  role?: string,
): View => {
  if (typeof idValue === "string") {
    const ref = childAt(refs, idValue, role);
    if (ref === undefined || !isPlainObject(value)) return value;
    return decorateOne(value, ref, readingResolvers, memo);
  }
  if (Array.isArray(idValue) && Array.isArray(value) && idValue.length === value.length) {
    return value.map((v, k) =>
      spliceField(v as View, idValue[k], refs, readingResolvers, memo, role),
    );
  }
  if (isPlainObject(idValue) && isPlainObject(value)) {
    const out: Record<string, View> = { ...(value as Record<string, View>) };
    for (const k of Object.keys(out)) {
      if (k in idValue) {
        out[k] = spliceField(out[k]!, idValue[k], refs, readingResolvers, memo, k);
      }
    }
    return out;
  }
  return value;
};

export function decorateChildren(
  view: Record<string, View>,
  hview: HView,
  schema: Schema,
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
): Record<string, View> {
  const byField = expandedChildrenByField(hview);
  if (byField.size === 0) return view;

  const idView = resolveView(schema, stripExpansions(hview)) as Record<string, unknown>;
  const out: Record<string, View> = { ...view };
  for (const [field, refs] of byField) {
    if (!(field in out)) continue;
    if (!alignsUnderStripping(schema.props.get(field) ?? schema.default)) continue;
    out[field] = spliceField(out[field]!, idView[field], refs, readingResolvers, memo);
  }
  return out;
}
