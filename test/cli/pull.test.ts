import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { exportOffer } from "../../src/federation/offer.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20_000 });

const TAB_SEED = "7a".repeat(32);
const TAB_OPERATOR = authorForSeed(TAB_SEED);

let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loam-pull-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function tabExport(): Promise<{ file: string; hex: string }> {
  const tab = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: TAB_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", TAB_OPERATOR, 2)],
    }),
  );
  await tab.append([observed(FERN, "height", 62, 1000, GARDENER_SEED)]);
  const answer = await tab.query(`{ plant(entity: "${FERN}") { height _hex } }`);
  const view = answer.data as { plant: { height: number; _hex: string } };
  expect(view.plant.height).toBe(62);
  const file = join(dir, "tab-export.json");
  writeFileSync(file, exportOffer(tab));
  await tab.close();
  return { file, hex: view.plant._hex };
}

describe("loam pull <file>: the store walks out of the browser", () => {
  it("same operator: the law BINDS on arrival — surface, grants, and the _hex match", async () => {
    const { file, hex } = await tabExport();
    const home = join(dir, "home");
    await run(["init", "--home", home, "--seed", TAB_SEED], io());
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/\d+ accepted/);

    const cli = await Gateway.open(new SqliteBackend(storePath(home)), { seed: TAB_SEED });
    const answer = await cli.query(`{ plant(entity: "${FERN}") { height _hex } }`);
    const view = answer.data as { plant: { height: number; _hex: string } };
    expect(view.plant.height).toBe(62);
    expect(view.plant._hex).toBe(hex);

    const allowed = await cli.query(
      `mutation { plant(entity: "${FERN}", height: 63) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(allowed.errors).toBeUndefined();
    const denied = await cli.query(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
      undefined,
      { actor: "e4".repeat(32) },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await cli.close();
  });

  it("foreign operator: the deltas cross, the law stays inert", async () => {
    const { file } = await tabExport();
    const home = join(dir, "home");
    await run(["init", "--home", home], io());
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/[1-9]\d* accepted/);

    const { readSeed } = await import("../../src/cli/config.js");
    const hers = await Gateway.open(new SqliteBackend(storePath(home)), {
      seed: readSeed(home),
    });
    let refused = "";
    try {
      await hers.query(`{ plant(entity: "${FERN}") { height } }`);
    } catch (e) {
      refused = String(e instanceof Error ? e.message : e);
    }
    expect(refused).toMatch(/nothing is registered/);
    await hers.close();
  });

  it("an erased id is refused at the door — even from a file", async () => {
    const home = join(dir, "home");
    await run(["init", "--home", home, "--seed", TAB_SEED], io());
    const fact = observed(FERN, "height", 30, 1000, TAB_SEED);
    const own = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: TAB_SEED }),
    );
    await own.append([fact]);
    await own.erase(fact.id, { reason: "unsaid" });
    await own.close();
    const carrier = await Gateway.open(new MemoryBackend(), { seed: TAB_SEED });
    await carrier.append([fact]);
    const file = join(dir, "carrier.json");
    writeFileSync(file, exportOffer(carrier));
    await carrier.close();

    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    const backend = new SqliteBackend(storePath(home));
    const held = (await backend.deltasSince(new Set())).map((d) => d.id);
    await backend.close();
    expect(held).not.toContain(fact.id);
  });

  it("refuses what is not an offer, without wrecking anything", async () => {
    const home = join(dir, "home");
    await run(["init", "--home", home], io());
    const file = join(dir, "not-an-offer.json");
    writeFileSync(file, `{"surprise": true}`);
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/deltas/);
  });

  it("wants exactly one source", async () => {
    expect(await run(["pull"], io())).toBe(2);
    expect(err.join("\n")).toMatch(/url\|file/);
  });

  it("the home's trust policy guards the door: a closed store admits nothing from a file", async () => {
    const { file } = await tabExport();
    const home = join(dir, "home");
    await run(["init", "--home", home], io());
    const { readSeed } = await import("../../src/cli/config.js");
    const seed = readSeed(home);
    const { trustClaims } = await import("../../src/gateway/trust.js");
    const own = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    await own.append([signClaims(trustClaims("closed", [], authorForSeed(seed), 5000), seed)]);
    await own.close();

    out.length = 0;
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/\b0 accepted/);
    expect(out.join("\n")).toMatch(/[1-9]\d* refused/);
  });

  it("an uninitialized home mints its own operator — and says what that means for the law", async () => {
    const { file } = await tabExport();
    const home = join(dir, "fresh");
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/initialized/);
    expect(printed).toMatch(/[1-9]\d* accepted/);
    expect(printed).toMatch(/loam init --seed/);
  });
});

describe("loam pull <url>: a live peer through the same door", () => {
  it("pulls a served store and re-pulling accepts nothing new — union is union", async () => {
    const srcHome = join(dir, "src");
    await run(["init", "--home", srcHome, "--seed", TAB_SEED], io());
    const src = await Gateway.boot(
      new SqliteBackend(storePath(srcHome)),
      assembleGenesis({ operatorSeed: TAB_SEED }),
    );
    await src.append([observed(FERN, "height", 62, 1000, TAB_SEED)]);
    await src.close();
    const handle = await run(["serve", "--http", "--home", srcHome, "--token", "tok"], io(), {
      detach: true,
    });
    if (typeof handle === "number") throw new Error("serve should return a handle");
    try {
      const destHome = join(dir, "dest");
      await run(["init", "--home", destHome], io());
      out.length = 0;
      const first = await run(
        ["pull", `${handle.url}/default`, "--token", "tok", "--home", destHome],
        io(),
      );
      expect(first).toBe(0);
      expect(out.join("\n")).toMatch(/[1-9]\d* accepted/);
      out.length = 0;
      const second = await run(
        ["pull", `${handle.url}/default`, "--token", "tok", "--home", destHome],
        io(),
      );
      expect(second).toBe(0);
      expect(out.join("\n")).toMatch(/\b0 accepted/);

      const envHome = join(dir, "env-dest");
      await run(["init", "--home", envHome], io());
      process.env["LOAM_TOKEN"] = "tok";
      try {
        out.length = 0;
        const viaEnv = await run(["pull", `${handle.url}/default`, "--home", envHome], io());
        expect(viaEnv).toBe(0);
        expect(out.join("\n")).toMatch(/[1-9]\d* accepted/);
      } finally {
        delete process.env["LOAM_TOKEN"];
      }
    } finally {
      await handle.close();
    }
  });

  it("a live peer wants a token, said up front — not a 403 later", async () => {
    const code = await run(["pull", "http://127.0.0.1:1/default", "--home", join(dir, "h")], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/token/);
  });

  it("a down peer names the address, the cause, and the cure — not a bare fetch failed", async () => {
    const { createServer } = await import("node:http");
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    await new Promise<void>((r) => server.close(() => r()));
    const code = await run(
      ["pull", `http://127.0.0.1:${port}/default`, "--home", join(dir, "h"), "--token", "tok"],
      io(),
    );
    expect(code).toBe(1);
    const printed = err.join("\n");
    expect(printed).toMatch(new RegExp(`http:\\/\\/127\\.0\\.0\\.1:${port}\\/default`));
    expect(printed).toMatch(/connection was refused/);
    expect(printed).toMatch(/check the address/);
    expect(printed).not.toMatch(/fetch failed/);
  });
});
