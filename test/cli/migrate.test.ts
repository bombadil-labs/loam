// `loam migrate <file>` — the migration policy at the command line. A 0.2-era offer goes in, a
// current-format offer comes out: schema definitions re-signed into the hyperschema vocabulary,
// the originals superseded. Run against the home whose seed authored the definitions.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Claims,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { parseOffer } from "../../src/federation/offer.js";
import { toWire } from "../../src/federation/wire.js";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { legacyInlineRegistrationClaims } from "../migrate/legacy.js";

vi.setConfig({ testTimeout: 15000 });

const NEW = "rhizomatic.hyperschema.";
const OLD = "rhizomatic.schema.";
const downgrade = (c: Claims): Claims => ({
  ...c,
  pointers: c.pointers.map((p) =>
    p.role.startsWith(NEW) ? { ...p, role: OLD + p.role.slice(NEW.length) } : p,
  ),
});

let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loam-migrate-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("loam migrate", () => {
  it("re-expresses a 0.2-era offer through the whole chain, and it answers on arrival", async () => {
    // Forge a genuine 0.2-era offer: a hyperschema definition on the OLD `rhizomatic.schema.*`
    // vocabulary at a `schema:` entity, plus the legacy INLINE registration — the shape that predates
    // every migration step, so `loam migrate` runs the full chain (roles → entity rename → lift).
    const op = authorForSeed(GARDENER_SEED);
    const oldStore = [
      signClaims(operatorMarkerClaims(op), GARDENER_SEED),
      signClaims(downgrade(publishHyperSchemaClaims(PLANT, "schema:Plant", op, 1)), GARDENER_SEED),
      signClaims(
        legacyInlineRegistrationClaims("schema:Plant", PLANT_POLICY, [FERN], op, 2),
        GARDENER_SEED,
      ),
      observed(FERN, "height", 40, 5000, GARDENER_SEED),
    ];
    const infile = join(dir, "old.json");
    const outfile = join(dir, "new.json");
    writeFileSync(infile, JSON.stringify({ deltas: oldStore.map(toWire) }));

    // The home must hold the ORIGINAL seed — re-signing definitions is the operator's own hand.
    expect(await run(["init", "--home", dir, "--seed", GARDENER_SEED], io())).toBe(0);
    expect(await run(["migrate", infile, "--home", dir, "--out", outfile], io())).toBe(0);
    // the report names each step of the chain, superseding as it goes
    expect(out.join("\n")).toMatch(/hyperschema-roles \(1 superseded\)/);
    expect(out.join("\n")).toMatch(/inline-schema-to-entity \(1 superseded\)/);

    // The migrated offer boots a store that answers the query the old offer couldn't — and the Schema
    // arrives as a first-class entity, lifted out of the registration.
    const migrated = parseOffer(readFileSync(outfile, "utf8"));
    const gw = await Gateway.boot(new MemoryBackend(), {
      operatorSeed: GARDENER_SEED,
      deltas: migrated,
    });
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(40);
    expect(gw.registrationVersions()[0]!.schema.name).toBe("Plant");
    await gw.close();
  });

  it("refuses without a seed to re-sign with", async () => {
    const infile = join(dir, "x.json");
    writeFileSync(infile, JSON.stringify({ deltas: [] }));
    // no `loam init` in this home → no seed
    const code = await run(["migrate", infile, "--home", dir], io());
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/no operator seed/);
  });
});
