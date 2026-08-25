// THE STOCK GRAPH's machinery (SPEC §50): dependencies derived from the bytes, install order
// from a topological sort, and the two-layer identity a divergence warning compares.
//
// NOTHING HERE IS DECLARED. An entry's dependencies are the schema and reading references its
// hyperschema body actually carries — collected by the substrate's own walkers, which cover
// every Term shape — mapped to shelf entries by the one-lens-per-entry rule (the CLI name is the
// kebab-case of the lens name). A hand-written `requires` list beside the body would be free to
// drift; the bytes cannot.
//
// IDENTITY IS TWO LAYERS, and the second is the one that bites. `versionedSchemaHash` is the
// canonical hash of the resolution Schema's props+default ALONE — the hyperschema body, where
// every expand and edge-reading assignment lives, is outside it. Two readings can agree on the
// schema hash while nesting entirely differently, so stock-identity compares the body's own
// canonical hash beside the schema's. Scoping the comparison to one layer would silence the
// divergence warning on exactly the divergences §50 introduces.

import {
  collectReadingRefs,
  collectRefs,
  parseSchema,
  parseTerm,
  termHash,
  type Term,
} from "@bombadil/rhizomatic";
import { versionedSchemaHash, type Registration } from "../gateway/registration.js";
import { STOCK_SCHEMAS, stockSchema, type StockSchema } from "./index.js";

/** The lens a shelf entry provides: its Schema's own name, the hyperschema's in the 1:1 case. */
export function entryLensName(entry: StockSchema): string {
  const reg = entry.registration as {
    hyperschema?: { name?: unknown };
    schema?: { name?: unknown };
  };
  const lens = reg.schema?.name ?? reg.hyperschema?.name;
  if (typeof lens !== "string" || lens === "") {
    throw new Error(`stock entry "${entry.name}" carries no lens name — the shelf is malformed`);
  }
  return lens;
}

/** The stated reading↔entry rule: the CLI name is the kebab-case of the lens name. */
export function cliNameOf(lens: string): string {
  return lens.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Every schema and reading reference a hyperschema body names — an expand's child program AND
 * its child reading, a `fix`'s invoked schema — as lens-layer names, deduplicated. Pinned
 * references (`name@hash`) have no place on the shelf and refuse rather than being skipped: a
 * skipped reference would be a dependency the install silently never satisfies.
 */
export function referencedLenses(bodyJson: unknown): readonly string[] {
  const body: Term = parseTerm(bodyJson);
  const names = new Set<string>();
  for (const ref of [...collectRefs(body), ...collectReadingRefs(body)]) {
    if (ref.kind !== "name") {
      throw new Error(
        `a stock body carries a pinned schema reference — the shelf names living readings only`,
      );
    }
    names.add(ref.name);
  }
  return [...names];
}

const bodyOf = (entry: StockSchema): unknown =>
  (entry.registration as { hyperschema?: { body?: unknown } }).hyperschema?.body;

/** One walked edge assignment: the expand's role, child program, and child reading. */
export interface EdgeAssignment {
  readonly role: string;
  readonly schema: string;
  readonly reading: string;
}

/** The edge assignments an entry's body declares, walked from the bytes — what the pin rail pins. */
export function edgeAssignments(entry: StockSchema): readonly EdgeAssignment[] {
  const out: EdgeAssignment[] = [];
  const walk = (t: Term): void => {
    switch (t.kind) {
      case "expand": {
        const role = t.role.kind === "exact" ? t.role.value : `<${t.role.kind}>`;
        const schema = t.schema.kind === "name" ? t.schema.name : t.schema.hash;
        const reading =
          t.reading === undefined
            ? schema
            : t.reading.kind === "name"
              ? t.reading.name
              : t.reading.hash;
        out.push({ role, schema, reading });
        walk(t.of);
        return;
      }
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        walk(t.of);
        return;
      case "union":
      case "intersect":
        walk(t.left);
        walk(t.right);
        return;
      case "difference":
        walk(t.of);
        walk(t.without);
        return;
      case "input":
      case "fix":
        return;
    }
  };
  walk(parseTerm(bodyOf(entry)));
  return out;
}

/**
 * An entry's direct dependencies, as shelf entries. Throws on a reference no entry provides —
 * that is a shelf-closure violation, and the rail that asserts closure leans on exactly this
 * refusal rather than a second walk that could share a bug with the first (H10's fix is the
 * hand-written table in the rail, not a duplicate here).
 */
export function stockDependencies(name: string): readonly StockSchema[] {
  const entry = stockSchema(name);
  if (entry === undefined) throw new Error(`no stock schema named "${name}"`);
  const self = entryLensName(entry);
  const out: StockSchema[] = [];
  for (const lens of referencedLenses(bodyOf(entry))) {
    if (lens === self) continue; // a self-reference is not a dependency (and would cycle)
    const dep = STOCK_SCHEMAS.find((e) => entryLensName(e) === lens);
    if (dep === undefined) {
      throw new Error(
        `stock entry "${name}" references the reading "${lens}", and no shelf entry provides ` +
          `it — the shelf must be closed, so this is a defect in the shelf, not in your store`,
      );
    }
    out.push(dep);
  }
  return out;
}

/**
 * The install order for one entry: its dependency closure, sinks first, the entry itself last.
 * Throws on a cycle — the reading-reference graph must be a DAG (§50: termination is a property
 * of the bytes, and a cycle would be an install that never finishes and a read that never
 * resolves).
 */
export function installOrder(name: string): readonly StockSchema[] {
  const order: StockSchema[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (n: string): void => {
    if (done.has(n)) return;
    if (visiting.has(n)) {
      throw new Error(
        `the stock shelf's reading-reference graph has a cycle through "${n}" — a shelf body ` +
          `may only expand readings whose own chains terminate`,
      );
    }
    visiting.add(n);
    for (const dep of stockDependencies(n)) visit(dep.name);
    visiting.delete(n);
    done.add(n);
    const entry = stockSchema(n);
    if (entry !== undefined) order.push(entry);
  };
  visit(name);
  return order;
}

/** The two-layer stock identity: the resolution Schema's hash and the gather body's hash. */
export interface StockIdentity {
  readonly schemaHash: string;
  readonly bodyHash: string;
}

export function stockIdentityOf(entry: StockSchema): StockIdentity {
  const reg = entry.registration as { schema?: unknown; hyperschema?: { body?: unknown } };
  return {
    schemaHash: versionedSchemaHash(parseSchema(reg.schema)),
    bodyHash: termHash(parseTerm(reg.hyperschema?.body)),
  };
}

export function boundIdentityOf(r: Registration): StockIdentity {
  return {
    schemaHash: versionedSchemaHash(r.schema),
    bodyHash: termHash(r.hyperschema.body),
  };
}

/**
 * What a bound reading's identity differs from stock in — `undefined` when stock-identical.
 * The answer names the layer(s), because the warning that carries it is the only place a person
 * learns WHICH kind of divergence they are composing with.
 */
export function divergenceOf(entry: StockSchema, bound: Registration): string | undefined {
  const stock = stockIdentityOf(entry);
  const theirs = boundIdentityOf(bound);
  const differs: string[] = [];
  if (stock.schemaHash !== theirs.schemaHash) differs.push("schema");
  if (stock.bodyHash !== theirs.bodyHash) differs.push("body");
  return differs.length === 0 ? undefined : differs.join("+");
}
