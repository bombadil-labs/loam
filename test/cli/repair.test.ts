import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, claimsToJson, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-repair-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function corrupt(path: string, id: string, claims: unknown): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

async function plantedHome(): Promise<{
  path: string;
  seed: string;
  a: ReturnType<typeof observed>;
  b: ReturnType<typeof observed>;
}> {
  await run(["init", "--home", home], io());
  const seed = readSeed(home);
  const path = storePath(home);
  const gateway = await Gateway.boot(
    new SqliteBackend(path),
    assembleGenesis({ operatorSeed: seed }),
  );
  const a = observed(FERN, "height", 30, 1000, seed);
  const b = observed(FERN, "height", 34, 2000, seed);
  await gateway.append([a, b]);
  await gateway.flush();
  await gateway.close();
  out.length = 0;
  return { path, seed, a, b };
}

describe("loam repair list", () => {
  it("an empty, legible store reports nothing to settle", async () => {
    await plantedHome();
    const code = await run(["repair", "list", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/nothing to settle/);
  });

  it("names each quarantined row, its reason, and a safe preview", async () => {
    const { path, a, b } = await plantedHome();
    corrupt(path, a.id, claimsToJson(b.claims));
    const code = await run(["repair", "list", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain(a.id);
    expect(printed).toMatch(/id-mismatch/);
    expect(printed).toMatch(/preview:/);
  });

  it("surfaces an entity-id legibility warning for an app delta at a reserved loam: name", async () => {
    const { path, seed } = await plantedHome();
    const strangerSeed = "cc".repeat(32);
    const stranger = signClaims(
      {
        timestamp: 5000,
        validFrom: 5000,
        author: authorForSeed(strangerSeed),
        pointers: [
          {
            role: "declares",
            target: { kind: "entity", entity: { id: "loam:store", context: "loam.operator" } },
          },
          { role: "note", target: { kind: "primitive", value: "i am the operator" } },
        ],
      },
      strangerSeed,
    );
    const backend = new SqliteBackend(path);
    await backend.append([stranger]);
    await backend.close();
    void seed;

    const code = await run(["repair", "list", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/legibility warning/);
    expect(printed).toContain("loam:store");
    expect(printed).toContain(stranger.id);
  });
});

describe("loam repair discard / re-admit / leave round-trip", () => {
  it("discard removes a quarantined row's bytes; a second list is clean", async () => {
    const { path, a, b } = await plantedHome();
    corrupt(path, a.id, claimsToJson(b.claims));

    const discard = await run(["repair", "discard", a.id, "--home", home], io());
    expect(discard).toBe(0);
    expect(out.join("\n")).toMatch(/discarded/);

    out.length = 0;
    await run(["repair", "list", "--home", home], io());
    expect(out.join("\n")).toMatch(/nothing to settle/);
  });

  it("discard refuses a key that is not quarantined (a good ground delta is erase's, not repair's)", async () => {
    const { b } = await plantedHome();
    const code = await run(["repair", "discard", b.id, "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/not quarantined/);
  });

  it("re-admit returns a row whose transient cause cleared, without reconstructing bytes", async () => {
    const { path, a, b } = await plantedHome();
    const honest = claimsToJson(a.claims);
    corrupt(path, a.id, claimsToJson(b.claims));
    await run(["repair", "list", "--home", home], io());
    expect(out.join("\n")).toMatch(/id-mismatch/);

    corrupt(path, a.id, honest);
    out.length = 0;
    const code = await run(["repair", "re-admit", a.id, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/re-admitted/);

    out.length = 0;
    await run(["repair", "list", "--home", home], io());
    expect(out.join("\n")).toMatch(/nothing to settle/);
  });

  it("re-admit reports a still-failing row as still quarantined, never forcing it", async () => {
    const { path, a, b } = await plantedHome();
    corrupt(path, a.id, claimsToJson(b.claims));
    const code = await run(["repair", "re-admit", a.id, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/still fails admission/);
  });

  it("leave is an idempotent no-op that says so", async () => {
    const { path, a, b } = await plantedHome();
    corrupt(path, a.id, claimsToJson(b.claims));
    const code = await run(["repair", "leave", a.id, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/left .* in quarantine/);
  });
});

describe("loam repair is the operator's alone", () => {
  it("refuses when the home holds no operator seed", async () => {
    const code = await run(["repair", "list", "--home", home], io());
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/operator/);
  });
});
