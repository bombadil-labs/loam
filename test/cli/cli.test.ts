// Step 8's contract: the `loam` CLI. init mints a home and an operator identity (never echoing
// the seed); serve boots a store and answers over HTTP; store inspects. The parser is small and
// hand-rolled, and every subcommand is exercised against real files and, for serve, a real
// listening server.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

// These boot real HTTP servers; a generous hang-guard keeps machine load from blowing the
// default per-test timeout (it only ever matters when something is genuinely stuck).
vi.setConfig({ testTimeout: 15000 });

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
  // maxRetries rides out a Windows EBUSY if the OS hasn't released a just-closed sqlite handle.
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

async function serveDetached(
  args: readonly string[],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(["serve", "--http", ...args], io(), { detach: true });
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

describe("loam serve", () => {
  it("self-initializes, boots a store, and answers a real HTTP query, then shuts down", async () => {
    // no prior `init` — serve mints the identity itself (turnkey containers rely on this)
    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "s3cret"]);
    const res = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(res.status).toBe(200);
    const junk = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(junk.status).toBe(401);
    await handle.close();
  });

  it("takes the token from LOAM_TOKEN as well as --token", async () => {
    process.env["LOAM_TOKEN"] = "from-env";
    try {
      const handle = await serveDetached(["--home", home, "--port", "0"]);
      const res = await fetch(`${handle.url}/default/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer from-env" },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      expect(res.status).toBe(200);
      await handle.close();
    } finally {
      delete process.env["LOAM_TOKEN"];
    }
  });

  it("persists across a restart: what one serve wrote, a later read finds on disk", async () => {
    const seed = "22".repeat(32);
    process.env["LOAM_SEED"] = seed;
    try {
      // first server boots (genesis lands on disk), answers, and shuts down
      const first = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
      const res = await fetch(`${first.url}/default/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t" },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      expect(res.status).toBe(200);
      await first.close();

      // a fresh process reads the store file: the genesis deltas are durably there
      out.length = 0;
      const code = await run(["store", "--home", home], io());
      expect(code).toBe(0);
      expect(out.join("\n")).not.toMatch(/\b0 deltas\b/); // the genesis persisted
      // and the operator identity is stable (same seed → same home)
      expect(readFileSync(join(home, "operator.seed"), "utf8").trim()).toBe(seed);
    } finally {
      delete process.env["LOAM_SEED"];
    }
  });

  it("refuses to serve without a token", async () => {
    const code = await run(["serve", "--http", "--home", home, "--port", "0"], io());
    expect(code).not.toBe(0);
    expect(err.join("\n")).toMatch(/token/i);
  });

  it("refuses a nonsense port instead of coercing it to a random one", async () => {
    const code = await run(
      ["serve", "--http", "--home", home, "--port", "43x1", "--token", "t"],
      io(),
    );
    expect(code).not.toBe(0);
    expect(err.join("\n")).toMatch(/port/i);
  });

  it("accepts --home=DIR (the =-style flag)", async () => {
    const handle = await serveDetached([`--home=${home}`, "--port=0", "--token=eq"]);
    const res = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer eq" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(res.status).toBe(200);
    await handle.close();
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
