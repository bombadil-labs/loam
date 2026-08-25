// T244 — the stock graph's dependency machinery (working spec §50, criterion 2).
//
// The dependency set of a shelf entry is DERIVED from its hyperschema body — the substrate's own
// walkers collect every schema and reading reference an expand names — and mapped to entries by
// the one-lens-per-entry rule. Nothing here reads a declared list, because none exists to read.
//
// THE HAND-WRITTEN TABLE IS THE POINT (H10). A closure test that walks with the same code the
// production walk uses under-collects identically on a shared bug and goes vacuously green. The
// EXPECTED table below is authored by hand, entry by entry, and the covers-check pins that the
// table names every shelf entry — so a new entry cannot land without a human writing down what
// it depends on, and a walk that misses a Term shape disagrees with the table instead of itself.

import { describe, expect, it } from "vitest";
import { STOCK_SCHEMAS, stockNames } from "../../src/stock/index.js";
import {
  cliNameOf,
  entryLensName,
  installOrder,
  referencedLenses,
  stockDependencies,
} from "../../src/stock/graph.js";

// Every entry's direct dependencies, BY HAND. Order inside a row is not asserted (sets compare);
// the row set is. Editing the shelf means editing this table in the same change — that is a
// feature, not a chore: the table is the human-legible dependency contract.
const EXPECTED: Record<string, readonly string[]> = {
  event: [],
  note: [],
  org: ["shallow-person"],
  person: [],
  post: [],
  "shallow-person": [],
};

describe("stock dependencies are derived from the bytes", () => {
  it("the hand-written table covers the shelf exactly — no entry escapes it", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...stockNames()].sort());
  });

  it("every entry's walked dependency set equals its hand-written row", () => {
    for (const entry of STOCK_SCHEMAS) {
      const walked = stockDependencies(entry.name)
        .map((d) => d.name)
        .sort();
      expect(walked, entry.name).toEqual([...(EXPECTED[entry.name] ?? [])].sort());
    }
  });

  // Shelf closure: every reading any body names is itself a shelf entry. `stockDependencies`
  // throws on a dangling reference, so closure is "no entry throws" — asserted entry by entry so
  // a failure names its entry rather than dying on the first.
  it("the shelf is closed — no body references a reading off the shelf", () => {
    for (const entry of STOCK_SCHEMAS) {
      expect(() => stockDependencies(entry.name), entry.name).not.toThrow();
    }
  });

  // Termination: the reading-reference graph is a DAG. `installOrder` topo-sorts and throws on a
  // cycle, so acyclicity is "every entry orders".
  it("the reading-reference graph is acyclic, and org orders sinks-first", () => {
    for (const entry of STOCK_SCHEMAS) {
      expect(() => installOrder(entry.name), entry.name).not.toThrow();
    }
    expect(installOrder("org").map((e) => e.name)).toEqual(["shallow-person", "org"]);
  });

  it("a leaf's install order is itself alone", () => {
    expect(installOrder("note").map((e) => e.name)).toEqual(["note"]);
  });

  // The one-lens-per-entry rule, both directions: the CLI name is the kebab-case of the lens
  // name, and no two entries provide the same lens.
  it("every entry's CLI name is the kebab-case of its lens name, and lenses are unique", () => {
    const lenses = new Set<string>();
    for (const entry of STOCK_SCHEMAS) {
      const lens = entryLensName(entry);
      expect(cliNameOf(lens), entry.name).toBe(entry.name);
      expect(lenses.has(lens), `lens ${lens} provided twice`).toBe(false);
      lenses.add(lens);
    }
  });

  // The kebab rule on names today's shelf does not exercise: digits stay attached to their word.
  // Pinned because the rule is PROTOCOL — a future entry must map the same way on every store.
  it("cliNameOf keeps digits with their word", () => {
    expect(cliNameOf("Sha256Sum")).toBe("sha256-sum");
    expect(cliNameOf("ShallowPerson")).toBe("shallow-person");
  });

  it("entryLensName refuses a shelf entry that carries no lens name at all", () => {
    expect(() =>
      entryLensName({ name: "broken", summary: "", registration: {} }),
    ).toThrow(/no lens name/);
  });

  // The walk sees the expand's BOTH names — the child program (`schema`) and the child reading
  // (`reading`). A walk that collected only one would still pass a shelf where the two coincide,
  // so this asserts against a body where they are made to differ.
  it("referencedLenses collects both the expand's schema and its reading", () => {
    const refs = referencedLenses({
      op: "expand",
      role: { exact: "members" },
      schema: "ProgramName",
      reading: "ReadingName",
      in: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    });
    expect([...refs].sort()).toEqual(["ProgramName", "ReadingName"]);
  });
});
