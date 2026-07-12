// SPEC §15, continuity: `loam pull <url|file>` — one command, one door, two sources. A live
// peer or a frozen offer, both through Gateway.federate: trust-admission, no standing needed,
// tombstones still bar the door. Then the fork the operator decides: under the SAME operator
// seed the imported law BINDS (the CLI store IS the browser store — the operator marker is the
// same delta by content address); under a foreign seed the deltas cross and the law stays
// inert, exactly as §5/§7/§14 promise.

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
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 15000 }); // real sqlite homes and a real HTTP server ride here

const TAB_SEED = "7a".repeat(32); // the browser store's operator — the seed that walks out
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

// The store born in a tab: governed, registered, lived-in — then frozen to a file. The
// gardener holds a REAL grant here, so the law that must bind on arrival has teeth to show.
async function tabExport(): Promise<{ file: string; hex: string }> {
  const tab = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: TAB_SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
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

    // The store answers through the IMPORTED registration — no register() ran here, ever.
    const cli = await Gateway.open(new SqliteBackend(storePath(home)), { seed: TAB_SEED });
    const answer = await cli.query(`{ plant(entity: "${FERN}") { height _hex } }`);
    const view = answer.data as { plant: { height: number; _hex: string } };
    expect(view.plant.height).toBe(62);
    // The round trip proves identity: the same view, hash for hash — this IS the tab's store.
    expect(view.plant._hex).toBe(hex);

    // And the imported GRANTS gate: the gardener (granted in the tab) writes; a stranger cannot.
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
    await run(["init", "--home", home], io()); // a minted seed — NOT the tab's
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/[1-9]\d* accepted/); // the testimony arrived whole

    // Under HER operator, the foreign registration reshapes nothing: no surface at all.
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

  it("a tombstoned id is refused at the door — even from a file", async () => {
    const home = join(dir, "home");
    await run(["init", "--home", home, "--seed", TAB_SEED], io());
    // The operator lands a fact, then unsays it.
    const fact = observed(FERN, "height", 30, 1000, TAB_SEED);
    const own = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: TAB_SEED }),
    );
    await own.append([fact]);
    await own.erase(fact.id, { reason: "unsaid" });
    await own.close();
    // A frozen offer arrives carrying the erased delta — the door remembers the hole.
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
    expect(held).not.toContain(fact.id); // erased stays erased; re-pulling is not forgiveness
  });

  it("refuses what is not an offer, without wrecking anything", async () => {
    const home = join(dir, "home");
    await run(["init", "--home", home], io());
    const file = join(dir, "not-an-offer.json");
    writeFileSync(file, `{"surprise": true}`);
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(2); // a malformed offer is a usage-class refusal, distinct from read failure
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
    expect(code).toBe(0); // refusal at the door is a report, not a crash
    expect(out.join("\n")).toMatch(/\b0 accepted/);
    expect(out.join("\n")).toMatch(/[1-9]\d* refused/);
  });

  it("an uninitialized home mints its own operator — and says what that means for the law", async () => {
    const { file } = await tabExport();
    const home = join(dir, "fresh"); // no `loam init` ever ran here
    const code = await run(["pull", file, "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/initialized/); // initHome-on-the-fly, like serve
    expect(printed).toMatch(/[1-9]\d* accepted/); // the deltas crossed
    // The fork stated plainly: a just-minted operator means the offer's law is foreign here.
    expect(printed).toMatch(/loam init --seed/);
  });
});

describe("loam pull <url>: a live peer through the same door", () => {
  it("pulls a served store and re-pulling accepts nothing new — union is union", async () => {
    // The source: a served home with a fact in it.
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
      expect(out.join("\n")).toMatch(/\b0 accepted/); // idempotent: double delivery is harmless

      // The token may ride the environment instead of the flag (containers pass it that way).
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
});
