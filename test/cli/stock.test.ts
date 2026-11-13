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
import type { StockSchema as BarrelStockSchema } from "../../src/index.js";

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

  it("every entry survives the SAME validator a hand-written file goes through", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.hyperschema.name, entry.name).toMatch(/^[A-Z]/);
      expect(parsed.schema.props.size, entry.name).toBeGreaterThan(0);
      expect(parsed.roots, entry.name).toEqual([]);
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
  it("registers `note` and a served store then takes a write and answers with it", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["register", "--stock", "note", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/registered\s+Note/i);

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

  it("the shelf is frozen through — no consumer can edit what a later --stock registers", () => {
    const entry = stockSchema("note");
    expect(entry).toBeDefined();
    const reg = entry!.registration as {
      roots: string[];
      writable: string[];
      hyperschema: { body: { in: { in: { policy: string }; pred: Record<string, unknown> } } };
      schema: { props: Record<string, { pick: { order: { byTimestamp: string } } }> };
    };
    expect(Object.isFrozen(STOCK_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(reg)).toBe(true);
    expect(() => reg.roots.push("note:mine")).toThrow();
    expect(() => reg.writable.push("secret")).toThrow();
    expect(reg.roots).toEqual([]);

    const mask = reg.hyperschema.body.in.in;
    expect(Object.isFrozen(mask)).toBe(true);
    expect(() => (mask.policy = "keep")).toThrow();
    expect(mask.policy).toBe("drop");
    expect(() => (reg.hyperschema.body.in.pred = { match: {} })).toThrow();
    const order = reg.schema.props["title"]!.pick.order;
    expect(Object.isFrozen(order)).toBe(true);
    expect(() => (order.byTimestamp = "asc")).toThrow();
    expect(order.byTimestamp).toBe("desc");
  });

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

  it("a stock name shadowed by a rival body says so rather than reporting a surface", async () => {
    await run(["init", "--home", home], io());
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
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/registered\s+Note/i);
    expect(err.join("\n"), "a persisted-but-unbound publish must say so").toMatch(/does not bind/);
  });
});

describe("the shelf is reachable from the package barrel", () => {
  it("exports the shelf, its lookups, and the StockSchema type", async () => {
    const barrel = await import("../../src/index.js");
    expect(barrel.STOCK_SCHEMAS.length).toBeGreaterThan(0);
    expect(barrel.stockNames()).toContain("note");
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
    expect(said).toContain("notes");
    for (const name of stockNames()) expect(said).toContain(name);
    expect(said).not.toMatch(/ENOENT|no such file/i);
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
