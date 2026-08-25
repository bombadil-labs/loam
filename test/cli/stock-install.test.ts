// T244 — transitive install, skip-if-bound, and the divergence warning (working spec §50,
// criteria 3, 4, and the evolve report), driven through the real CLI.
//
// TWO LEVELS, as P3 requires. Object level: what the CLI prints — the report IS the surface a
// person acts on, and story 3's whole point is what Priya learns from one line of stderr. Delta
// level: the store is reopened cold and `readRegistrations` says which lenses actually bind.
//
// TWO BESPOKE FIXTURES, and both are deliberate (§50 criterion 4; premortem findings 2 and 6):
//
//   (a) SAME program name, DIVERGENT body — the composable case. The resolution Schema is
//       BYTE-IDENTICAL to stock's (same props, same default), so a divergence check that
//       compares only `versionedSchemaHash` sees no difference: the warning appears only if the
//       hyperschema BODY is compared too.
//   (b) The LENS under a FOREIGN program name (lens ≠ program — H6). The substrate resolves an
//       expand's `schema` ref by program name and admits one reading per lens, so this reading
//       can never serve org's reference, and installing stock beside it would evict it. The
//       install must refuse in the open, exit 2, with the store untouched.
//
// GAP, named per P3 doctrine: "the pre-flight covers the WHOLE closure before any delta lands"
// is unpinnable on a one-dependency shelf — an interleaved check-then-install is observationally
// identical here. The first multi-edge entry (person-graph, later in this arc) earns the rail
// that distinguishes them: its second dependency mismatching must leave the FIRST unpublished.

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
    return readRegistrations(reopened.reactor, operatorOf(h));
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
    // Sinks first: the dependency's report precedes the requested entry's.
    expect(printed.indexOf("also installed shallow-person")).toBeLessThan(
      printed.search(/registered\s+Org/i),
    );
    // No divergence and no bind trouble on a fresh home — and no evolve report either: nothing
    // was bound before this install, so "evolves it" here would be a false report (H7's shape).
    expect(printed).not.toMatch(/evolves it/);
    expect(err.join("\n")).not.toMatch(/not stock|does not bind/);

    // DELTA LEVEL: reopened cold, both lenses bind for this home's operator.
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
    // Stock-identical: no divergence warning has any business here.
    expect(err.join("\n")).not.toMatch(/not stock/);
  });

  // A bespoke registration file over the shelf's lens name. `program` and the mask are the two
  // knobs the fixtures below turn; the resolution Schema stays byte-identical to stock's.
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
            // `annotate`, where stock is `drop` — a BODY divergence only: the resolution
            // Schema below is byte-identical to stock's, so the schema hashes agree.
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

  // Fixture (a): story 3 — compose and warn, detected by the BODY layer.
  it("a bespoke reading under the same program name is skipped, composed with, and warned about by body", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "their-shallow.json");
    writeFileSync(rival, bespokeShallow("ShallowPerson"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);
    // A FILE registration takes no stock closure and reports no evolve — the evolve line is the
    // stock path's report, and printing it here would be a false claim about a first publish.
    expect(out.join("\n")).not.toMatch(/evolves it/);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    // Compose, never refuse divergence: exit 0, org lands and binds through THEIR program.
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/shallow-person already bound — skipped/);
    expect(printed).not.toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/registered\s+Org/i);
    // The warning: one stderr line naming the stock identity and what differed. The schema
    // hashes agree by construction, so only a body comparison can produce this line.
    const warned = err.join("\n");
    expect(warned).toMatch(/shallow-person is bound to a reading that is not stock ShallowPerson@/);
    expect(warned).toMatch(/differs: body/);
    expect(warned).not.toMatch(/does not bind/);

    // DELTA LEVEL: the bespoke reading survives AS ITSELF. A length-1 check alone is vacuous —
    // both readings derive the same registration entity, so latest-per-(entity, lens) returns
    // exactly one row whichever reading won. The identity of the survivor is the assertion: its
    // body is the bespoke `annotate` gather, not stock's `drop` — a regression that published
    // the dep despite the skip line would flip this hash and fail here.
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

  // Fixture (b): the H6 shape — the composition cannot bind, so nothing may land.
  it("a bespoke lens under a foreign program name refuses in the open, before any delta lands", async () => {
    await run(["init", "--home", home], io());
    const rival = join(home, "my-shallow.json");
    writeFileSync(rival, bespokeShallow("MyShallow"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["register", "--stock", "org", "--home", home], io());
    // A refusal in the open: usage-voiced exit 2, naming the mismatch and the remedy.
    expect(code, "a refusal, not an internal error").toBe(2);
    const said = err.join("\n");
    expect(said).toMatch(/serves it from the program "MyShallow"/);
    expect(said).toMatch(/republish your reading under the program name ShallowPerson/);
    expect(out.join("\n")).not.toMatch(/registered|also installed/i);

    // DELTA LEVEL: the store is untouched — her binding survives alone, UNDER HER PROGRAM, and
    // no Org landed. The program assertion is what distinguishes "untouched" from "evicted and
    // replaced by something answering the same lens".
    const rows = await boundRows(home);
    const shallow = rows.filter((r) => (lensOf(r) as string) === "ShallowPerson");
    expect(shallow).toHaveLength(1);
    expect(programOf(shallow[0]!) as string).toBe("MyShallow");
    expect(rows.map((r) => lensOf(r) as string)).not.toContain("Org");
  });

  // The false-evolve shape (H6, found in review): a bespoke file claims the LENS `Org` from its
  // own program `MyOrg`. `--stock org` can neither evolve it (an evolve is a republish at the
  // SAME registration entity) nor land beside it (the registry admits one reading per lens), so
  // the target takes the same open refusal its dependencies do — before any delta, deps
  // included, lands. The old behavior was worse than a false "evolves it" line: the publish
  // threw AFTER the dependencies were already installed.
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

    // DELTA LEVEL: nothing landed — not even the dependency, which the pre-flight runs before.
    const lenses = await boundLenses(home);
    expect(lenses).not.toContain("ShallowPerson");
    expect(lenses.filter((l) => l === "Org")).toHaveLength(1);
  });

  // The divergence warning's OTHER layer: a bespoke reading whose body is byte-identical to
  // stock's while its resolution Schema differs (oldest-first default). Only a schema-hash
  // comparison can produce this warning — deleting that layer from divergenceOf fails here.
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

  // GAP, named: the pre-flight groups EVERY contender per lens and composes when any of them
  // serves the referenced program name. A multi-contender store state is not constructible
  // through this CLI — the registry admits one reading per lens, so a second entity's claim
  // refuses at publish — and arises only through federation under a §47 binding policy. The
  // grouped check is exercised here only at group size 1; the many-contender path earns its rail
  // when the federation rails of this arc (criterion 9's file) can build that store honestly.

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
