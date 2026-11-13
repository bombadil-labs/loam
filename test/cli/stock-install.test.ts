import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import {
  lensOf,
  programOf,
  readRegistrations,
  type Registration,
} from "../../src/gateway/registration.js";
import { boundIdentityOf, stockIdentityOf } from "../../src/stock/graph.js";
import { stockSchema } from "../../src/stock/index.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-stock-graph-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const operatorOf = (h: string): string =>
  (JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { operator: string }).operator;

async function boundRows(h: string): Promise<Registration[]> {
  const backend = new SqliteBackend(join(h, "store.sqlite"));
  const reopened = await Gateway.open(backend);
  try {
    return readRegistrations(reopened.reactor, reopened.validityNow(), operatorOf(h));
  } finally {
    await reopened.close();
  }
}

const boundLenses = async (h: string): Promise<string[]> =>
  (await boundRows(h)).map((r) => lensOf(r) as string);

describe("loam register --stock installs the closure", () => {
  it("a fresh `--stock org` installs shallow-person first, reports both, and both bind", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/registered\s+Org/i);
    expect(printed.indexOf("also installed shallow-person")).toBeLessThan(
      printed.search(/registered\s+Org/i),
    );
    expect(printed).not.toMatch(/evolves it/);
    expect(err.join("\n")).not.toMatch(/not stock|does not bind/);

    const lenses = await boundLenses(home);
    expect(lenses).toEqual(expect.arrayContaining(["Org", "ShallowPerson"]));
  });

  it("a dependency already stock-bound is skipped, silently identical", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "shallow-person", "--home", home], io())).toBe(0);
    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/shallow-person already bound — skipped/);
    expect(printed).not.toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/registered\s+Org/i);
    expect(err.join("\n")).not.toMatch(/not stock/);
  });

  const bespokeShallow = (program: string): string =>
    JSON.stringify({
      hyperschema: {
        name: program,
        alg: 1,
        body: {
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "annotate", in: "input" },
          },
        },
      },
      schema: {
        name: "ShallowPerson",
        alg: 1,
        props: { name: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
      roots: [],
      writable: ["name"],
    });

  it("a bespoke reading under the same program name is skipped, composed with, and warned about by body", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "their-shallow.json");
    writeFileSync(rival, bespokeShallow("ShallowPerson"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);
    expect(out.join("\n")).not.toMatch(/evolves it/);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/shallow-person already bound — skipped/);
    expect(printed).not.toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/registered\s+Org/i);
    const warned = err.join("\n");
    expect(warned).toMatch(/shallow-person is bound to a reading that is not stock ShallowPerson@/);
    expect(warned).toMatch(/differs: body/);
    expect(warned).not.toMatch(/does not bind/);

    const rows = await boundRows(home);
    expect(rows.map((r) => lensOf(r) as string)).toEqual(
      expect.arrayContaining(["Org", "ShallowPerson"]),
    );
    const shallow = rows.filter((r) => (lensOf(r) as string) === "ShallowPerson");
    expect(shallow).toHaveLength(1);
    const survivor = boundIdentityOf(shallow[0]!);
    const stock = stockIdentityOf(stockSchema("shallow-person")!);
    expect(survivor.schemaHash, "schemas are byte-identical by construction").toBe(
      stock.schemaHash,
    );
    expect(survivor.bodyHash, "the bespoke body, not stock's, must survive").not.toBe(
      stock.bodyHash,
    );
  });

  it("a bespoke lens under a foreign program name refuses in the open, before any delta lands", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "my-shallow.json");
    writeFileSync(rival, bespokeShallow("MyShallow"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code, "a refusal, not an internal error").toBe(2);
    const said = err.join("\n");
    expect(said).toMatch(/serves it from the program "MyShallow"/);
    expect(said).toMatch(/republish your reading under the program name ShallowPerson/);
    expect(out.join("\n")).not.toMatch(/registered|also installed/i);

    const rows = await boundRows(home);
    const shallow = rows.filter((r) => (lensOf(r) as string) === "ShallowPerson");
    expect(shallow).toHaveLength(1);
    expect(programOf(shallow[0]!) as string).toBe("MyShallow");
    expect(rows.map((r) => lensOf(r) as string)).not.toContain("Org");
  });

  it("a bespoke lens under a foreign program over the requested name refuses in the open", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "my-org.json");
    writeFileSync(
      rival,
      JSON.stringify({
        hyperschema: {
          name: "MyOrg",
          alg: 1,
          body: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
        schema: {
          name: "Org",
          alg: 1,
          props: { name: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: [],
        writable: ["name"],
      }),
    );
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code, "the target takes the same refusal its deps do").toBe(2);
    const said = err.join("\n");
    expect(said).toMatch(/serves it from the program "MyOrg"/);
    expect(out.join("\n")).not.toMatch(/registered|also installed|evolves it/i);

    const lenses = await boundLenses(home);
    expect(lenses).not.toContain("ShallowPerson");
    expect(lenses.filter((l) => l === "Org")).toHaveLength(1);
  });

  it("a same-program bespoke binding at another entity is a contest, never an evolve", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "org-at-mine.json");
    writeFileSync(
      rival,
      JSON.stringify({
        hyperschema: {
          name: "Org",
          alg: 1,
          body: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
        schema: {
          name: "Org",
          alg: 1,
          props: { name: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: [],
        entity: "hyperschema:Mine",
        writable: ["name"],
      }),
    );
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/registered\s+Org/i);
    expect(printed, "a contest is not an evolve").not.toMatch(/evolves it/);
    expect(err.join("\n")).toMatch(/does not bind/);
  });

  it("a schema-divergent, body-identical bespoke reading warns with differs: schema", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "their-shallow-schema.json");
    writeFileSync(
      rival,
      JSON.stringify({
        hyperschema: {
          name: "ShallowPerson",
          alg: 1,
          body: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: {
                hasPointer: { targetEntity: { var: "root" }, context: { exact: "name" } },
              },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
        schema: {
          name: "ShallowPerson",
          alg: 1,
          props: { name: { pick: { order: { byTimestamp: "asc" } } } },
          default: { pick: { order: { byTimestamp: "asc" } } },
        },
        roots: [],
        writable: ["name"],
      }),
    );
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/shallow-person already bound — skipped/);
    const warned = err.join("\n");
    expect(warned).toMatch(/not stock ShallowPerson@/);
    expect(warned).toMatch(/differs: schema/);
    expect(warned).not.toMatch(/differs: body|differs: schema\+body/);
  });

  it("re-running the requested name reports the evolve and still binds", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/Org was already bound — this publish evolves it/);
    expect(err.join("\n"), "an evolve must bind, not merely persist").not.toMatch(/does not bind/);
  });
});
