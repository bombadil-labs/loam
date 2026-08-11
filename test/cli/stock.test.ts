// T85 — `loam register --stock <name>`: the shipped shelf, and the promise that it is a
// CONVENIENCE rather than a second door.
//
// A new file rather than an extension of test/cli/cli.test.ts because the two halves of this rail
// want different fixtures, and because the surface being pinned is new.
//
// ASSERTED AT BOTH LEVELS, as P3 requires. Delta level: the operator-signed definition and its
// registration are really in the sqlite file, so a reopened store grows the surface back. Object
// level: a real HTTP server built from those deltas takes a write and answers a read with the
// value — which is what `--stock note` is actually FOR, and which no amount of delta-shape
// checking can see.
//
// WHAT THIS DELIBERATELY DOES NOT COVER: the shelf's editorial content — whether `note` wants a
// `pinned` field is a judgment, not an invariant, and a rail asserting the exact prop list would
// only freeze today's taste. What is pinned is that every entry is a VALID registration through the
// shared validator, and that at least one of them works end to end for a person.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { entityGatherJson } from "../../src/gateway/gather.js";
import { STOCK_SCHEMAS, stockNames, stockSchema } from "../../src/stock/index.js";
// Imported FROM THE BARREL, by the name README hands an embedder — so deleting the re-export in
// src/index.ts is a typecheck failure here rather than a silent loss of the public surface.
import type { StockSchema as BarrelStockSchema } from "../../src/index.js";

// These boot real HTTP servers and real sqlite stores; the generous hang-guard every heavy CLI
// file here carries.
vi.setConfig({ testTimeout: 20000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-stock-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function serveDetached(
  args: readonly string[],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(["serve", "--http", ...args], io(), { detach: true });
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

const gql = async (
  url: string,
  query: string,
): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }> => {
  const res = await fetch(`${url}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
};

describe("the stock shelf itself", () => {
  it("is not empty, and carries the names the ticket named", () => {
    expect(stockNames()).toEqual(expect.arrayContaining(["note", "person", "event", "post"]));
  });

  // THE NO-PRIVILEGED-PATH RAIL. Every stock entry is a registration a person could have typed,
  // and it is proven so by the very validator a typed file goes through. A shelf entry that
  // needed a looser parse would fail here rather than sneak in behind a flag.
  it("every entry survives the SAME validator a hand-written file goes through", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.hyperschema.name, entry.name).toMatch(/^[A-Z]/);
      expect(parsed.schema.props.size, entry.name).toBeGreaterThan(0);
      // roots are the deployer's call, never the shelf's — an entity outside them is lazily held
      expect(parsed.roots, entry.name).toEqual([]);
      // a shape nobody may write to would be a read-only toy on day one
      expect(parsed.writable?.length ?? 0, entry.name).toBeGreaterThan(0);
    }
  });

  it("names its entries in --help, with the shelf spelled out", async () => {
    const code = await run(["register", "--help"], io());
    expect(code).toBe(0);
    const printed = [...out, ...err].join("\n");
    expect(printed).toContain("--stock");
    for (const name of stockNames()) expect(printed).toContain(name);
  });
});

describe("loam register --stock", () => {
  // OBJECT LEVEL + DELTA LEVEL, one story: register the shape, serve, write a fact, read it back.
  it("registers `note` and a served store then takes a write and answers with it", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["register", "--stock", "note", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/registered\s+Note/i);

    // DELTA LEVEL: the definition is really on disk, signed BY THIS HOME'S OPERATOR, and filed at
    // the entity the success line named — not merely "some definition exists".
    const operator = (
      JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as { operator: string }
    ).operator;
    const backend = new SqliteBackend(join(home, "store.sqlite"));
    const reopened = await Gateway.open(backend);
    const defines = [...reopened.reactor.snapshot()].filter(
      (d) =>
        d.claims.author === operator &&
        d.claims.pointers.some(
          (p) =>
            p.role.endsWith("hyperschema.defines") &&
            p.target.kind === "entity" &&
            p.target.entity.id === "hyperschema:Note",
        ),
    );
    expect(
      defines.length,
      "an operator-signed definition filed at hyperschema:Note",
    ).toBeGreaterThan(0);
    await reopened.close();

    // OBJECT LEVEL: a fresh serve grows the surface from those deltas, and a person can use it.
    // `tags` rides along because it is the shelf's only OTHER policy shape (`all`, not `pick`) —
    // without it the list-valued half of every stock entry is exercised by nothing.
    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      const wrote = await gql(
        handle.url,
        `mutation { note(entity: "note:groceries", title: "milk", body: "two litres") { title } }`,
      );
      expect(wrote.errors, JSON.stringify(wrote.errors)).toBeUndefined();
      await gql(
        handle.url,
        `mutation { note(entity: "note:groceries", tags: "errand") { title } }`,
      );
      await gql(
        handle.url,
        `mutation { note(entity: "note:groceries", tags: "urgent") { title } }`,
      );
      const read = await gql(
        handle.url,
        `{ note(entity: "note:groceries") { title body tags _hex } }`,
      );
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      expect(read.data?.["note"]).toMatchObject({ title: "milk", body: "two litres" });
      // `all` keeps every claim, oldest first — a `pick` policy here would surface one tag.
      expect(read.data?.["note"]).toMatchObject({ tags: ["errand", "urgent"] });
    } finally {
      await handle.close();
    }
  });

  it("every name on the shelf registers on a fresh home", async () => {
    for (const name of stockNames()) {
      const h = mkdtempSync(join(tmpdir(), "loam-stock-each-"));
      try {
        out.length = 0;
        await run(["init", "--home", h], io());
        const code = await run(["register", "--stock", name, "--home", h], io());
        expect(code, `--stock ${name}`).toBe(0);
        expect(out.join("\n"), `--stock ${name}`).toMatch(/registered/i);
      } finally {
        rmSync(h, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  });

  // The shelf is a module-level constant shared by every call in a process, so it is frozen
  // THROUGH: a consumer that edited an entry would rewrite what every later `--stock` registers.
  // Asserted at the runtime rather than the type, because the CLI's registration path is typed
  // `unknown` and erases `readonly` entirely.
  //
  // HONEST NOTE ON THE PAIRING: `--stock` clones before registering, and nothing downstream
  // mutates today — so removing the clone alone is invisible to any rail. The freeze is what makes
  // the guarantee observable, and the clone is what keeps a frozen entry usable if a future
  // downstream normalizes its input in place. This rail sees the freeze; it cannot see the clone.
  it("the shelf is frozen through — no consumer can edit what a later --stock registers", () => {
    const entry = stockSchema("note");
    expect(entry).toBeDefined();
    const reg = entry!.registration as { roots: string[]; writable: string[] };
    expect(Object.isFrozen(STOCK_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(reg)).toBe(true);
    expect(() => reg.roots.push("note:mine")).toThrow();
    expect(() => reg.writable.push("secret")).toThrow();
    expect(reg.roots).toEqual([]);
  });

  // Re-registering is the ordinary evolve path (`Republishing at the same entity evolves it`), and
  // the question a rail must ask of it is about the STORE, not the shelf: does the second publish
  // still BIND? `publishRegistration` reports `bound: false` for a publish the replay could not
  // serve, and the CLI now says so on stderr — so a second `--stock note` that shadowed the first
  // would leave that warning behind and a serve would answer nothing.
  it("registering twice still binds, and the served surface still answers", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "note", "--home", home], io())).toBe(0);
    err.length = 0;
    expect(await run(["register", "--stock", "note", "--home", home], io())).toBe(0);
    expect(err.join("\n"), "a second publish must bind, not merely persist").not.toMatch(
      /does not bind/,
    );

    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      const wrote = await gql(
        handle.url,
        `mutation { note(entity: "note:twice", title: "still here") { title } }`,
      );
      expect(wrote.errors, JSON.stringify(wrote.errors)).toBeUndefined();
      const read = await gql(handle.url, `{ note(entity: "note:twice") { title } }`);
      expect(read.data?.["note"]).toMatchObject({ title: "still here" });
    } finally {
      await handle.close();
    }
  });

  // THE OTHER DIRECTION, and the one that matters (H7). `publishRegistration` returns
  // `{ persisted: true, bound: false, reason }` when the deltas land but the replay cannot serve
  // them — a rival body already answering for the same program name. The deltas ARE down, so
  // "registered" stays true; what would be a false report is the line promising the next serve
  // grows the surface from it. Without the warning this exits 0, says success, and serves the OTHER
  // schema — the operator has no way to learn that from the CLI.
  it("a stock name shadowed by a rival body says so rather than reporting a surface", async () => {
    await run(["init", "--home", home], io());
    // A hand-authored `Note` at its own entity, with a DIFFERENT gather body (annotate, not drop).
    const rival = join(home, "rival.json");
    writeFileSync(
      rival,
      JSON.stringify({
        hyperschema: { name: "Note", alg: 1, body: entityGatherJson({ mask: "annotate" }) },
        schema: {
          name: "Note",
          alg: 1,
          props: { title: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: [],
        entity: "myschema:Note",
        writable: ["title"],
      }),
    );
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    err.length = 0;
    out.length = 0;
    const code = await run(["register", "--stock", "note", "--home", home], io());
    // The write happened — this is a qualified success, not a refusal.
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/registered\s+Note/i);
    // ...and the qualification is present, naming what the operator would otherwise not learn.
    expect(err.join("\n"), "a persisted-but-unbound publish must say so").toMatch(/does not bind/);
  });
});

// The feature's PUBLIC surface, not just the CLI's private use of it. An export nobody exercises
// can be deleted from the barrel with every other rail still green (test/index-surface.test.ts
// states the repo's rule); README points an embedder at `STOCK_SCHEMAS` by that name.
describe("the shelf is reachable from the package barrel", () => {
  it("exports the shelf, its lookups, and the StockSchema type", async () => {
    const barrel = await import("../../src/index.js");
    expect(barrel.STOCK_SCHEMAS.length).toBeGreaterThan(0);
    expect(barrel.stockNames()).toContain("note");
    // A value use AND a type use: the type re-export is what the .d.ts pin in pack-stock.test.ts
    // protects, and a signature-level alias is what makes its deletion a typecheck failure.
    const entry: BarrelStockSchema | undefined = barrel.stockSchema("note");
    expect(entry?.name).toBe("note");
    expect(barrel.STOCK_SCHEMAS.map((s) => s.name)).toEqual([...stockNames()]);
  });
});

describe("loam register --stock refuses in the open", () => {
  it("an unknown name names the whole shelf, and is a usage error, not a missing file", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["register", "--stock", "notes", "--home", home], io());
    expect(code, "a usage error, distinct from an internal error (1)").toBe(2);
    const said = err.join("\n");
    expect(said).toContain("notes"); // what was asked for
    for (const name of stockNames()) expect(said).toContain(name); // what is available
    expect(said).not.toMatch(/ENOENT|no such file/i); // never a raw file error
  });

  it("a stock name AND a file is refused rather than one silently winning", async () => {
    await run(["init", "--home", home], io());
    const code = await run(
      ["register", join(home, "mine.json"), "--stock", "note", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/--stock/);
  });

  it("neither a file nor a stock name points at both ways in", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["register", "--home", home], io());
    expect(code).toBe(2);
    const said = err.join("\n");
    expect(said).toMatch(/schema\.json/);
    expect(said).toMatch(/--stock/);
  });
});
