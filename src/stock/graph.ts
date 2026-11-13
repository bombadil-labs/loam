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

export function cliNameOf(lens: string): string {
  return lens.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

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

export interface EdgeAssignment {
  readonly role: string;
  readonly schema: string;
  readonly reading: string;
}

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

export function stockDependencies(name: string): readonly StockSchema[] {
  const entry = stockSchema(name);
  if (entry === undefined) throw new Error(`no stock schema named "${name}"`);
  const self = entryLensName(entry);
  const out: StockSchema[] = [];
  for (const lens of referencedLenses(bodyOf(entry))) {
    if (lens === self) continue;
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

export function divergenceOf(entry: StockSchema, bound: Registration): string | undefined {
  const stock = stockIdentityOf(entry);
  const theirs = boundIdentityOf(bound);
  const differs: string[] = [];
  if (stock.schemaHash !== theirs.schemaHash) differs.push("schema");
  if (stock.bodyHash !== theirs.bodyHash) differs.push("body");
  return differs.length === 0 ? undefined : differs.join("+");
}
