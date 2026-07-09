// Step 8's contract: the `loam` CLI. init mints a home and an operator identity (never echoing
// the seed); serve boots a store and answers over HTTP; store inspects. The parser is small and
// hand-rolled, and every subcommand is exercised against real files and, for serve, a real
// listening server.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-cli-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loam init", () => {
  it("creates a home with config and an operator identity, and never prints the seed", async () => {
    const code = await run(["init", "--home", home], io());
    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as {
      operator: string;
      seed?: string;
    };
    expect(config.operator).toMatch(/^ed25519:/);
    expect(config.seed).toBeUndefined(); // the seed lives in its own guarded file, not the config
    const seedFile = readFileSync(join(home, "operator.seed"), "utf8").trim();
    expect(seedFile).toMatch(/^[0-9a-f]{64}$/);
    // the printed output announces the operator but never the secret
    const printed = out.join("\n");
    expect(printed).toContain(config.operator);
    expect(printed).not.toContain(seedFile);
  });

  it("is idempotent: a second init keeps the first identity", async () => {
    await run(["init", "--home", home], io());
    const first = readFileSync(join(home, "operator.seed"), "utf8");
    await run(["init", "--home", home], io());
    expect(readFileSync(join(home, "operator.seed"), "utf8")).toBe(first);
  });

  it("imports a supplied seed instead of minting one", async () => {
    const seed = "11".repeat(32);
    await run(["init", "--home", home, "--seed", seed], io());
    expect(readFileSync(join(home, "operator.seed"), "utf8").trim()).toBe(seed);
    expect(out.join("\n")).not.toContain(seed); // still never echoed
  });

  it("refuses a positional seed (the natural --seed typo) without echoing it", async () => {
    const code = await run(["init", "--home", home, "11".repeat(32)], io());
    expect(code).not.toBe(0);
    expect(err.join("\n")).not.toContain("11".repeat(32));
  });
});

describe("loam serve", () => {
  it("boots a store and answers a real HTTP query, then shuts down", async () => {
    await run(["init", "--home", home], io());
    out.length = 0;
    const handle = await run(
      ["serve", "--http", "--home", home, "--port", "0", "--token", "s3cret"],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error("serve should return a running handle");

    const res = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(res.status).toBe(200);
    // a junk token is refused
    const junk = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(junk.status).toBe(401);
    await handle.close();
  });

  it("refuses to serve without a token", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["serve", "--http", "--home", home, "--port", "0"], io());
    expect(code).not.toBe(0);
    expect(err.join("\n")).toMatch(/token/i);
  });
});

describe("loam store", () => {
  it("reports on a store: its delta count", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["store", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/deltas/i);
  });
});

describe("loam help and version", () => {
  it("prints help listing the subcommands", async () => {
    const code = await run(["--help"], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    for (const cmd of ["init", "serve", "store"]) expect(printed).toContain(cmd);
  });

  it("prints a version", async () => {
    const code = await run(["--version"], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/\d+\.\d+\.\d+/);
  });

  it("an unknown command is an error with guidance", async () => {
    const code = await run(["frobnicate"], io());
    expect(code).not.toBe(0);
    expect(err.join("\n")).toMatch(/unknown|help/i);
  });
});
