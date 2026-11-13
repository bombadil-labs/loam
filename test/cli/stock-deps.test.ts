import { describe, expect, it } from "vitest";
import { STOCK_SCHEMAS, stockNames } from "../../src/stock/index.js";
import {
  cliNameOf,
  entryLensName,
  installOrder,
  referencedLenses,
  stockDependencies,
} from "../../src/stock/graph.js";

const EXPECTED: Record<string, readonly string[]> = {
  event: ["shallow-person"],
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

  it("the shelf is closed — no body references a reading off the shelf", () => {
    for (const entry of STOCK_SCHEMAS) {
      expect(() => stockDependencies(entry.name), entry.name).not.toThrow();
    }
  });

  it("the reading-reference graph is acyclic, and org orders sinks-first", () => {
    for (const entry of STOCK_SCHEMAS) {
      expect(() => installOrder(entry.name), entry.name).not.toThrow();
    }
    expect(installOrder("org").map((e) => e.name)).toEqual(["shallow-person", "org"]);
  });

  it("a leaf's install order is itself alone", () => {
    expect(installOrder("note").map((e) => e.name)).toEqual(["note"]);
  });

  it("every entry's CLI name is the kebab-case of its lens name, and lenses are unique", () => {
    const lenses = new Set<string>();
    for (const entry of STOCK_SCHEMAS) {
      const lens = entryLensName(entry);
      expect(cliNameOf(lens), entry.name).toBe(entry.name);
      expect(lenses.has(lens), `lens ${lens} provided twice`).toBe(false);
      lenses.add(lens);
    }
  });

  it("cliNameOf keeps digits with their word", () => {
    expect(cliNameOf("Sha256Sum")).toBe("sha256-sum");
    expect(cliNameOf("ShallowPerson")).toBe("shallow-person");
  });

  it("entryLensName refuses a shelf entry that carries no lens name at all", () => {
    expect(() => entryLensName({ name: "broken", summary: "", registration: {} })).toThrow(
      /no lens name/,
    );
  });

  it("every entry's lens name equals its program name", () => {
    for (const entry of STOCK_SCHEMAS) {
      const program = (entry.registration as { hyperschema: { name: string } }).hyperschema.name;
      expect(entryLensName(entry), entry.name).toBe(program);
    }
  });

  it("a pinned schema reference in a body refuses rather than being skipped", () => {
    expect(() =>
      referencedLenses({
        op: "expand",
        role: { exact: "members" },
        schema: { pinned: "abc123" },
        reading: "ShallowPerson",
        in: "input",
      }),
    ).toThrow(/pinned/);
  });

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
